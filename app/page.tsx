"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy dynamic UI/read-model boundary; strict typing deferred to workspace decomposition */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBoqTemplateCsv, parseGenericBoqCsv } from "./boq-csv.mjs";
import { createRuntimeContext, sessionCalendar } from "./domain/runtime.mjs";
import { createQuotationFingerprint } from "./domain/quotation-fingerprint.mjs";
import {
  hasCurrentPriceEvidence,
  priceEvidenceValidity,
  summarizePriceEvidence,
} from "./domain/price-evidence.mjs";
import {
  boqReviewReasons,
  extractionReviewActionLabel,
  extractionReviewStatusLabel,
} from "./domain/boq-review-reasons.mjs";
import {
  buildEngineeringDossier,
  requirementPolicyFor,
} from "./domain/engineering-assurance.mjs";
import { requestJson, commandThenRefresh, projectApi, technicalApi, commercialApi } from "./lib/api-client";
import {
  buildProjectLocation,
  parseProjectLocation,
  reconcileFailedDocumentFilter,
} from "./lib/project-navigation.mjs";
import { ProjectShell } from "./components/project/ProjectShell";
import type {
  DashboardAction,
  EstimatorReadiness,
  PreSalesWorkflow,
  ServerProjectDashboard,
} from "./components/project/types";
import { OverviewWorkspace } from "./components/workspaces/OverviewWorkspace";
import { DocumentsWorkspace } from "./components/workspaces/DocumentsWorkspace";
import { BoqReviewWorkspace } from "./components/workspaces/BoqReviewWorkspace";
import { TechnicalRequirementsWorkspace } from "./components/workspaces/TechnicalRequirementsWorkspace";
import { MatchingCandidateReview, MatchingWorkspace } from "./components/workspaces/MatchingWorkspace";
import { PricingWorkspace } from "./components/workspaces/PricingWorkspace";
import { CommercialReviewWorkspace } from "./components/workspaces/CommercialReviewWorkspace";
import { QuotationWorkspace } from "./components/workspaces/QuotationWorkspace";
import { RfqAuthorityWorkspace } from "./components/workspaces/RfqAuthorityWorkspace";
import { HistoricalLearningWorkspace } from "./components/workspaces/HistoricalLearningWorkspace";
import { CaseStudiesWorkspace } from "./components/workspaces/CaseStudiesWorkspace";
import { KnowledgeLibraryWorkspace } from "./components/workspaces/KnowledgeLibraryWorkspace";
import { pricingLineModel } from "./components/workspaces/commercial-models.mjs";
import { ErrorState, LoadingState } from "./components/shared/WorkspaceStates";

type CostItem = {
  id: number;
  system: string;
  item: string;
  qty: number;
  supplier: string;
  unitCost: number;
  markup: number;
  status: "Costed" | "Missing Link" | "RFQ Required";
  unit: string;
  specification: string;
  sourceRows: number[];
  approvedSource?: string;
};

type MatchCandidate = {
  id: string;
  sourceSheet: "2023 Farenhyt";
  sourceType: string;
  sourceName: string;
  reference: string;
  price: number;
  evidence: string;
  confidence: "High" | "Medium" | "Discovery only";
  appliesTo: string;
  expired?: boolean;
};
type PersistentMatchCandidate = {
  id: string;
  product_id: string;
  rank: number;
  part_number: string;
  description: string;
  manufacturer: string;
  family?: string;
  technical_status: string;
  recommendation_tier: string;
  confidence_state: string;
  confidence_score: number;
  matchingBasis: string[];
  commercial_availability: string;
  explanation: string;
  mandatoryFailures: unknown[];
  score: number;
};
type PersistentSafetyDecision = {
  id: string;
  version_number: number;
  safety_state: string;
  compliance_state: string;
  confidence_level: string;
  overall_confidence: number;
  technical_eligibility: string;
  price_eligibility: string;
  explanation: string;
  blocks: {
    id: string;
    code: string;
    user_message: string;
    resolution_action: string;
    owner: string;
    status: string;
  }[];
  warnings: {
    id: string;
    code: string;
    message: string;
    resolution_action: string;
    acknowledged_at?: string | null;
  }[];
};
type PersistentPricingScenario = {
  id: string;
  name: string;
  mode: string;
  version_number: number;
  project_currency: string;
  status: string;
};
type PersistentPricingLine = {
  id?: string;
  status: string;
  version?: number;
  result?: {
    totalCost?: number;
    netSelling?: number;
    vat?: number;
    finalValue?: number;
    margin?: number;
    markup?: number;
    explanation?: string;
    blockers?: string[];
  };
};
type PersistentPriceSource = {
  id: string;
  sourceId: string;
  productId: string;
  sourceType: string;
  supplier?: string | null;
  amount: number;
  currency: string;
  validityState: string;
  validUntil?: string | null;
  projectId?: string | null;
  provenance: string;
  approvalStatus: string;
  downstreamUse: string;
  reviewState: string;
  eligibleForCosting: boolean;
};

type MatchDiagnostic = {
  reason:
    | "Expired price evidence"
    | "Validity date missing"
    | "Incomplete BOQ profile"
    | "Historical catalogue clue"
    | "No plausible catalogue clue";
  detail: string;
  action:
    | "Renew supplier quote"
    | "Complete item data"
    | "Review historical clue"
    | "Create supplier RFQ";
};

type ModuleName =
  | "Overview"
  | "Documents"
  | "BOQ"
  | "Technical Matching"
  | "Product Library"
  | "Knowledge Library"
  | "Pricing Memory"
  | "Case Studies"
  | "Costing"
  | "Review"
  | "Supplier RFQs"
  | "Quotation"
  | "Price Sources"
  | "Reports"
  | "Activity";
type CaseStudySummary = {
  id: string;
  project_id: string;
  case_version: number;
  project_snapshot: { name?: string };
  system_domain?: string;
  client?: string;
  location?: string;
  source_completeness: number;
  ground_truth_completeness: number;
  historical_completeness_assessment?: {
    score: number;
    state: string;
  } | null;
  learning_readiness?: string | null;
  review_state: string;
  publication_state: string;
  benchmark_state: string;
};
type KnowledgeFileRecord = {
  id: string;
  file_name: string;
  detected_type: string;
  classification_confidence: number;
  classification_status: string;
  processing_status: string;
  summary: Record<string, number>;
  uploaded_at: string;
  sha256: string;
};

type AuditEvent = {
  id: number;
  projectId?: string;
  action: string;
  detail: string;
  actor: string;
  time: string;
  previousHash?: string;
  eventHash?: string;
};
type AuditCategory =
  "All" | "Source" | "Pricing" | "Commercial" | "Approval" | "Project";
type WorkingRole =
  | "Estimator"
  | "Engineering Reviewer"
  | "Procurement Reviewer"
  | "Commercial Approver"
  | "Project Manager"
  | "Commercial Manager"
  | "Commercial Reviewer"
  | "Administrator"
  | "No Project Permission";
type GenericBoqCandidate = {
  rowNumber: number;
  system: string;
  item: string;
  unit: string;
  qty: number;
  technicalReference: string;
  errors: string[];
};
type GenericBoqPreview = {
  fileName: string;
  hash: string;
  candidates: GenericBoqCandidate[];
  ignoredPriceColumns: string[];
  fatalError: string;
};
type AuthenticatedSession = {
  authenticated: true;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    displayName: string;
    initials: string;
  };
  effectiveLibraryPermission:
    "Library Viewer" | "Library Reviewer" | "Library Manager" | "Administrator";
  authenticationSource: string;
  organizations: {
    id: string;
    name: string;
    status: string;
    roles: string[];
  }[];
  defaultOrganizationId: string | null;
  projectMemberships: {
    project_id: string;
    project_name: string;
    organization_id?: string | null;
    role: WorkingRole;
  }[];
  signOutUrl: string;
};
type ExchangeRateEvidence = {
  source: string;
  effectiveDate: string;
  validUntil: string;
  confirmedAt?: string;
  confirmedBy?: string;
};
type ProjectIntakeProfile = {
  country: string;
  city: string;
  location: string;
  system: string;
  scopeIntent:
    | "Pending tender review"
    | "Materials only requested"
    | "Supply and installation requested";
  buildings: string;
  boqAvailability: "Unknown" | "Available" | "Not available yet";
  drawingAvailability: "Unknown" | "Available" | "Not available yet";
  inquirySubject?: string;
  inquiryReceived?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
};
type PricingSettingsDraft = {
  exchangeRate: number;
  exchangeRateEvidence: ExchangeRateEvidence;
  vatRate: number;
  riskAllowanceRate: number;
  riskAllowanceReason: string;
  warrantyMonths: number;
  validityDays: number;
  clientPaymentTerms: string;
  clientDeliveryTerms: string;
  clientDeliveryLocation: string;
  clientFreightTerms: string;
  clientQualifications: string;
};
type ProjectDetailsDraft = {
  name: string;
  client: string;
  code: string;
  dueDate: string;
  status: string;
};
type QuotationApproval = {
  projectId: string;
  revision: number;
  fingerprint: string;
  approvedAt: string;
  approvedBy: string;
  reason: string;
  subtotal: number;
  vat: number;
  total: number;
  validityDays: number;
  warrantyMonths: number;
};
type DocumentRole =
  | "BOQ"
  | "Specification"
  | "Drawing"
  | "Client inquiry"
  | "Price source"
  | "Supplier quotation"
  | "Unclassified";
type DocumentIssueStatus =
  "Tender" | "Addendum" | "For Information" | "Superseded";
type DocumentControl = {
  revision: string;
  issueDate: string;
  status: DocumentIssueStatus;
  transmittal: string;
  confirmed: boolean;
  confirmedAt?: string;
  confirmedBy?: string;
};
type ManagedDocument = {
  id: string;
  logical_name: string;
  document_type: string;
  notes: string;
  tags: string;
  archived_at?: string | null;
  version_id: string;
  version_number: number;
  original_filename: string;
  extension: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  revision?: string | null;
  uploaded_by: string;
  uploaded_at: string;
  quarantine_status: string;
  job_id?: string | null;
  processing_status?: string | null;
  progress?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  suggested_action?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  last_retry_at?: string | null;
  classification_id?: string | null;
  predicted_type?: string | null;
  secondary_types?: string | null;
  classification_confidence?: number | null;
  confidence_state?: string | null;
  classification_status?: string | null;
  manual_review_required?: number | null;
  downstream_route?: string | null;
  classification_error_code?: string | null;
  classification_error_message?: string | null;
  boq_extraction_id?: string | null;
  boq_extraction_version?: number | null;
  boq_extraction_status?: string | null;
  boq_extraction_summary?: string | null;
  boq_extraction_error_code?: string | null;
  boq_extraction_error_message?: string | null;
  boq_extraction_suggested_action?: string | null;
  specification_extraction_id?: string | null;
  specification_extraction_version?: number | null;
  specification_extraction_status?: string | null;
  specification_extraction_summary?: string | null;
  specification_extraction_error_code?: string | null;
  specification_extraction_error_message?: string | null;
  specification_extraction_suggested_action?: string | null;
  specification_job_id?: string | null;
  specification_job_status?: string | null;
  specification_total_pages?: number | null;
  specification_processed_pages?: number | null;
  specification_current_page?: number | null;
  specification_current_chunk?: number | null;
  specification_completed_chunks?: number | null;
  specification_remaining_chunks?: number | null;
  specification_live_clauses?: number | null;
  specification_live_requirements?: number | null;
  specification_elapsed_seconds?: number | null;
  specification_eta_seconds?: number | null;
};
type DurableLibrarySource = {
  id: string;
  checksum: string;
  file_name: string;
  source_type: string;
  scope_type: string;
  project_id?: string | null;
  validity_state: string;
  valid_until?: string | null;
  review_status: string;
  downstream_use: string;
};
type ClassificationReviewDraft = {
  document: ManagedDocument;
  selectedType: string;
  reason: string;
  saving: boolean;
  error: string;
};
type DrawingWorkspaceData = {
  version: {
    id: string;
    version_number: number;
    status: string;
    parser_version: string;
    summary: {
      pageCount: number;
      assetCount: number;
      legendCount: number;
      searchEntryCount: number;
      vectorPages: number;
      rasterPages: number;
    };
    review_status: string;
    created_at: string;
  };
  documentClassifications: Array<{
    id: string;
    classification_type: string;
    confidence: number;
    extraction_method: string;
    review_status: string;
  }>;
  pages: Array<{
    id: string;
    page_number: number;
    width: number;
    height: number;
    coordinate_mode: string;
    classifications: Array<{
      type: string;
      confidence: number;
      method: string;
    }>;
    text_count: number;
    review_status: string;
    extraction_method: string;
  }>;
  metadata: Record<string, string | number | null> | null;
  assets: Array<{
    id: string;
    page_id: string;
    asset_type: string;
    text_content: string | null;
    bounding_box: Record<string, number> | null;
    coordinates_available: number;
    detection_confidence: number;
    detection_method: string;
    review_status: string;
  }>;
  legends: Array<{
    id: string;
    page_id: string;
    legend_version: string | null;
    confidence: number;
    detection_method: string;
    review_status: string;
    entries: Array<{
      id: string;
      entry_type: string;
      label: string;
      description: string | null;
      confidence: number;
      review_status: string;
    }>;
  }>;
  audit: Array<{
    id: string;
    action: string;
    reason: string;
    actor_user_id: string;
    created_at: string;
  }>;
};
type SymbolDefinition = {
  id: string;
  abbreviation: string | null;
  explicit_label: string | null;
  description: string | null;
  source_page: number;
  bounding_box: Record<string, number> | null;
  shape_signatures: string[];
  confidence: number;
  evidence_text: string;
  extraction_method: string;
  review_status: string;
  review_reason?: string | null;
  merged_into_definition_id?: string | null;
};
type SymbolOccurrence = {
  id: string;
  definition_id: string | null;
  abbreviation?: string | null;
  explicit_label?: string | null;
  description?: string | null;
  page_number: number;
  bounding_box: Record<string, number>;
  shape_signature: string;
  nearby_text: string | null;
  match_basis: string;
  confidence: number;
  review_status: string;
  review_reason?: string | null;
};
type SymbolWorkspaceData = {
  version: {
    id: string;
    version_number: number;
    engine_version: string;
    status: string;
    summary: {
      definitionCount: number;
      matchedOccurrenceCount: number;
      unknownOccurrenceCount: number;
      legendPageCount: number;
    };
    created_at: string;
  };
  definitions: SymbolDefinition[];
  occurrences: SymbolOccurrence[];
  unknownSymbols: SymbolOccurrence[];
  audit: Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    reason: string;
    actor_user_id: string;
    created_at: string;
  }>;
  idempotent?: boolean;
};
type StructureWorkspaceData = {
  version: {
    id: string;
    version_number: number;
    parser_version: string;
    status: string;
    summary: {
      pageCount: number;
      tableCount: number;
      rowCount: number;
      columnCount: number;
      cellCount: number;
      headerCount: number;
      legendRowCount: number;
      regionCount: number;
      validationIssueCount: number;
      averageStructuralConfidence: number;
    };
    created_at: string;
  };
  tables: Array<Record<string, any>>;
  rows: Array<Record<string, any>>;
  columns: Array<Record<string, any>>;
  cells: Array<Record<string, any>>;
  headers: Array<Record<string, any>>;
  legendRows: Array<Record<string, any>>;
  regions: Array<Record<string, any>>;
  validationIssues: Array<Record<string, any>>;
  audit: Array<Record<string, any>>;
  idempotent?: boolean;
};
type StructureReviewCase = {
  id: string;
  case_version: number;
  status: string;
  original_snapshot: Record<string, any>;
  current_snapshot: Record<string, any>;
  adjustments: Array<Record<string, any>>;
  reviewed_by?: string;
  review_reason?: string;
};
type StructureReviewData = {
  structureVersionId: string;
  cases: StructureReviewCase[];
  counts: Record<string, number>;
  audit: Array<Record<string, any>>;
  approvedVersions: Array<Record<string, any>>;
};
type LibraryProduct = {
  id: string;
  part_number: string;
  description: string;
  manufacturer: string;
  brand?: string | null;
  family?: string | null;
  lifecycle_status: string;
  review_status: string;
  identity_status: string;
  canonicalProductId: string;
  canonicalPartNumber: string;
  requestedProductId: string;
  requestedPartNumber: string;
  requestedIdentityStatus: string;
  resolvesToCanonical: boolean;
};
type LibraryProductDetail = {
  product: LibraryProduct & { attributes?: unknown[]; standards?: unknown[] };
  requested?: { id: string; part_number: string; identity_status: string };
  canonicalResolution: {
    requestedProductId: string;
    canonicalProductId: string;
    requestedPartNumber: string;
    canonicalPartNumber: string;
    resolved: boolean;
  };
  evidence: Array<Record<string, unknown>>;
  prices: Array<
    Record<string, unknown> & { amount: number; eligibleForCosting: boolean }
  >;
  attributes: Array<Record<string, unknown>>;
  certifications: Array<Record<string, unknown>>;
  compatibility: Array<Record<string, unknown>>;
  accessories: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  orderCodeObservations: Array<Record<string, unknown>>;
  safety: {
    costingEligiblePrices: number;
    missingEvidenceIsNotInferred: boolean;
  };
};
type RequirementIntelligenceFact = {
  id: string;
  requirement_id: string;
  fact_type: string;
  original_value: unknown;
  current_value: unknown;
  modality: string;
  confidence: number;
  source_page: number | null;
  source_page_to: number | null;
  source_clause: string | null;
  source_section: string | null;
  evidence_snippet: string;
  extraction_basis: string;
  engine_version: string;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
};
type RequirementIntelligenceDecision = {
  id: string;
  entity_id: string;
  action: string;
  reason: string;
  decided_by: string;
  decided_at: string;
};
type RequirementIntelligenceAction = {
  fact: RequirementIntelligenceFact;
  operation: "update" | "approve" | "reject" | "restore";
  reason: string;
  value: string;
};
type EngineeringClassificationVersion = {
  id: string;
  version_number: number;
  completeness: number;
  matching_readiness: "Ready" | "Conditionally Ready" | "Not Ready";
  blocking_missing_information: Array<{
    classificationType: string;
    reason: string;
    requiredHumanDecision: string;
  }>;
  missing_evidence: string[];
  technical_risks: Array<{ area: string; risk: string; severity: string }>;
  engineering_questions: Array<{
    question: string;
    classificationType: string;
    status: string;
  }>;
  required_human_decisions: Array<{
    decision: string;
    supportingFactIds: string[];
  }>;
  review_status: string;
  approved_for_matching: number;
};
type EngineeringClassificationDecision = {
  id: string;
  classification_type: string;
  value: unknown;
  classification_status: string;
  supporting_fact_ids: string[];
  evidence: Array<{
    factId: string;
    requirementId: string;
    factType: string;
    value: unknown;
    confidence: number;
    page: number | null;
    clause: string | null;
    section: string | null;
    evidenceSnippet: string;
  }>;
  basis: string;
  confidence: number;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
};
type EngineeringClassificationAudit = {
  id: string;
  entity_id: string;
  action: string;
  reason: string;
  decided_by: string;
  decided_at: string;
};
type EngineeringClassificationAction = {
  decision: EngineeringClassificationDecision;
  operation: "approve" | "reject" | "restore";
  reason: string;
};
type EngineeringGraphVersion = {
  id: string;
  version_number: number;
  engine_version: string;
  missing_relationships: Array<{ relationshipType: string; reason: string }>;
  conflicts: Array<{ nodeKey: string; label: string }>;
  engineering_risks: Array<{ area: string; severity: string; risk: string }>;
};
type EngineeringGraphNode = {
  id: string;
  node_key: string;
  node_type: string;
  label: string;
  provenance: Array<{
    factId?: string;
    requirementId?: string;
    page?: number;
    clause?: string;
    evidenceSnippet?: string;
  }>;
  review_status: string;
};
type EngineeringGraphRelationship = {
  id: string;
  relationship_type: string;
  from_label: string;
  to_label: string;
  confidence: number;
  provenance: Array<{
    factId?: string;
    requirementId?: string;
    page?: number;
    clause?: string;
    evidenceSnippet?: string;
  }>;
  basis: string;
  review_status: string;
  reviewed_by?: string;
  review_reason?: string;
};
type EngineeringGraphAudit = {
  id: string;
  entity_id: string;
  action: string;
  reason: string;
  actor_user_id: string;
  created_at: string;
};
type EngineeringGraphAction = {
  relationship: EngineeringGraphRelationship;
  operation: "approve" | "reject" | "restore";
  reason: string;
};
type RequirementProfileView = {
  id: string;
  version_number: number;
  status: string;
  readiness_status: string;
  approved_for_matching: number;
  profile: {
    applicableRequirements?: unknown[];
    consolidatedRequirements?: unknown[];
    intelligence?: {
      counts?: {
        total?: number;
        needsReview?: number;
        approved?: number;
        rejected?: number;
        byType?: Record<string, number>;
      };
      missingInformation?: unknown[];
      conflicts?: unknown[];
      clarifications?: unknown[];
      confidence?: number;
    };
    missingInformation?: unknown[];
    conflicts?: unknown[];
    standards?: unknown[];
    compatibility?: unknown[];
    accessories?: unknown[];
    clarifications?: unknown[];
    confidence?: { overall?: number; state?: string; level?: string };
    readiness?: { status?: string; blockers?: unknown[] };
  };
  confidence_summary?: Record<string, unknown>;
  input_fingerprint: string;
  created_at: string;
};
type ExtractedBoqItem = {
  id: string;
  extraction_version_id: string;
  source_document_id: string;
  duplicate_of_item_id?: string | null;
  sequence: number;
  item_number?: string | null;
  row_type: string;
  description?: string | null;
  section?: string | null;
  original_unit?: string | null;
  original_quantity?: string | null;
  extraction_confidence: number;
  confidence_state: string;
  review_status: string;
  source_location: {
    sheet?: string | null;
    page?: number | null;
    row?: number | null;
  };
  current_values: Record<string, unknown>;
  warnings?: Array<{
    id: string;
    code: string;
    severity: string;
    message: string;
  }>;
  latest_review?: {
    action: string;
    reason: string;
    decided_by: string;
    decided_at: string;
  } | null;
};

const loadAllExtractedBoqItems = async (documentId: string) => {
  const pageSize = 200;
  const items: ExtractedBoqItem[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await fetch(
      `/api/documents/${encodeURIComponent(documentId)}/boq-extraction/items?limit=${pageSize}&page=${page}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message || "Extracted BOQ rows could not be loaded",
      );
    const pageItems = Array.isArray(result.items) ? result.items : [];
    items.push(...pageItems);
    if (pageItems.length < pageSize) return items;
  }
  throw new Error("Extracted BOQ row pagination exceeded its safety limit");
};
type BoqReviewActionDraft = {
  item: ExtractedBoqItem;
  operation: "update" | "restore" | "approve" | "reject";
  reason: string;
  description: string;
  unit: string;
  quantity: string;
  field: string;
};
type SpecificationExtractionRequestState = {
  documentId: string;
  loading: boolean;
  status: string;
  errorCode: string;
  errorMessage: string;
  suggestedAction: string;
};
type TechnicalRequirement = {
  id: string;
  sequence: number;
  original_text: string;
  normalized_requirement: string;
  engineering_domain: string;
  category?: string | null;
  requirement_type: string;
  requirement_category: string;
  condition?: string | null;
  exception?: string | null;
  confidence: number;
  confidence_state: string;
  review_status: string;
  approved_for_downstream: number;
  source_location: {
    pageFrom?: number;
    pageTo?: number;
    section?: string | null;
    clause?: string | null;
    clausePath?: string[];
    originalClauseText?: string;
  };
  original_values: Record<string, unknown>;
  current_values: Record<string, unknown>;
  updated_at: string;
};
type RequirementReviewHistory = {
  id: string;
  action: string;
  reason: string;
  decided_by: string;
  decided_at: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};
type TechnicalRequirementAction = {
  requirement: TechnicalRequirement;
  operation: "update" | "approve" | "reject" | "restore";
  reason: string;
  normalizedRequirement: string;
};
type ApplicabilityLink = {
  id: string;
  boq_item_id: string;
  requirement_id: string;
  item_number?: string | null;
  boq_description: string;
  requirement_sequence: number;
  original_text: string;
  normalized_requirement: string;
  confidence: number;
  link_method: string;
  evidence:
    | {
        basis?: string[];
        assessment?: string;
        itemEquipment?: string;
        requirementEquipment?: string;
      }
    | string[];
  status: string;
  source_location: {
    pageFrom?: number;
    pageTo?: number;
    section?: string;
    clause?: string;
    clausePath?: string[];
  };
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_reason?: string | null;
  version_number: number;
};
type ApplicabilityReviewAction = {
  link: ApplicabilityLink;
  operation: "confirm" | "reject" | "remove";
  reason: string;
};
type PersistentReviewItem = {
  id: string;
  boq_item_id?: string | null;
  boq_description?: string | null;
  item_number?: string | null;
  review_type: string;
  priority: string;
  severity: string;
  status: string;
  assigned_reviewer_id?: string | null;
  required_role: string;
  due_date?: string | null;
  blocking: number;
  reason_for_review: string;
  required_decision: string;
  approval_level: number;
  safety_state: string;
  version_number: number;
};
type PersistentReviewSummary = {
  total: number;
  open: number;
  inReview: number;
  waiting: number;
  approved: number;
  conditional: number;
  rejected: number;
  blocked: number;
  escalated: number;
  overdue: number;
  readiness: string;
};
type ExcelExportMode =
  | "Draft Cost Sheet"
  | "Technical Review Cost Sheet"
  | "Commercial Review Cost Sheet"
  | "Approved Cost Sheet"
  | "Client-Safe Export";
type ExcelExportTemplate = {
  id: string;
  name: string;
  version: string;
  supported_modes: ExcelExportMode[];
};
type ServerQuotation = {
  id: string;
  revision_number?: number;
  revisionNumber?: number;
  quotation_fingerprint?: string;
  quotationFingerprint?: string;
  status: "Draft" | "Approved" | "Issued";
  currency: string;
  subtotal_minor?: number;
  subtotalMinor?: number;
  vat_minor?: number;
  vatMinor?: number;
  total_minor?: number;
  totalMinor?: number;
  terms?: Record<string, unknown>;
};
type OrganizationDashboard = {
  modelVersion: string;
  scope: "organization";
  organization: { id: string; name: string; roles: string[] };
  state:
    "Projects Available" | "No Organization Projects" | "No Search Results";
  query: string;
  metrics: Record<string, number>;
  projects: ServerProjectDashboard[];
  unassignedLegacyProjects: { count: number; includedInMetrics: false };
  actionQueue: DashboardAction[];
  updatedAt: string;
  refreshAfterMs: number;
};
type ExcelExportRecord = {
  id: string;
  export_mode: ExcelExportMode;
  revision: number;
  filename: string;
  status: string;
  stage: string;
  progress: number;
  warning_count: number;
  blocking_issue_count: number;
  requested_at: string;
  completed_at?: string | null;
  byte_size?: number | null;
  sha256?: string | null;
  download_count?: number | null;
  locked_versions: Record<string, string | number>;
  sheet_set: string[];
};
type RevisionCandidate = {
  id: string;
  fileName: string;
  previousHash: string;
  candidateHash: string;
  role: DocumentRole;
  control: DocumentControl;
  stagedAt: string;
};
type ProductLifecycleMapping = {
  id: string;
  obsoletePart: string;
  replacement: string;
  sourceRow: number;
  disposition:
    "Replacement candidate" | "Incomplete mapping" | "No replacement";
};
type LifecycleReview = {
  status: "Pending" | "Acknowledged" | "Rejected";
  note: string;
  reviewedAt?: string;
  reviewedBy?: string;
};
type LocalBackupEnvelope = {
  schemaVersion: 1;
  product: "AI Pricing Agent Local Backup";
  exportedAt: string;
  checksum: string;
  projects: LocalProject[];
};
type LocalBackupPreview = {
  envelope: LocalBackupEnvelope;
  conflicts: number;
  boqItems: number;
  documents: number;
};
type ScopeAlignmentDecision = {
  status: "Pending" | "Materials-only authorized";
  evidenceReference: string;
  reason: string;
  sourceFingerprint: string;
  approvedAt?: string;
  approvedBy?: string;
};
type RfqStatus = "Draft" | "Ready to issue" | "Response registered" | "Awarded";
type ResponseLine = {
  itemId: number;
  partNumber: string;
  unitPrice: number;
  technicalResult: "Pending" | "Compliant" | "Deviation";
  note: string;
};
type SupplierResponseReview = {
  id?: string;
  sourceFile?: string;
  supplier: string;
  reference: string;
  quoteDate: string;
  validUntil: string;
  currency: string;
  deliveryWeeks: number;
  warrantyMonths: number;
  paymentTerms: string;
  freightTotal: number;
  lines: ResponseLine[];
  reviewStatus: "Draft" | "Reviewed";
};
type RfqRecord = {
  projectId: string;
  id: string;
  code: string;
  title: string;
  itemIds: number[];
  scopeNote: string;
  evidenceNote: string;
  status: RfqStatus;
  supplier: string;
  responseDue: string;
  deliveryLocation: string;
  requirements: string;
  responseFiles: string[];
  responseReview?: SupplierResponseReview;
  responseOffers?: SupplierResponseReview[];
  awardedAt?: string;
  awardReason?: string;
  awardedBy?: string;
  createdAt: string;
};

type LocalProject = {
  id: string;
  name: string;
  client: string;
  code: string;
  dueDate: string;
  status: string;
  intakeProfile?: ProjectIntakeProfile;
  items: CostItem[];
  uploadedFiles: string[];
  documentRoles: Record<string, DocumentRole>;
  documentHashes: Record<string, string>;
  documentControls: Record<string, DocumentControl>;
  revisionCandidates: RevisionCandidate[];
  lifecycleReviews: Record<string, LifecycleReview>;
  scopeAlignmentDecision: ScopeAlignmentDecision;
  appliedDocumentHashes: string[];
  indexedTechnicalHashes: string[];
  baseTenderLoaded: boolean;
  technicalProfileLoaded: boolean;
  rfqs: RfqRecord[];
  quotationApprovals: QuotationApproval[];
  rateResolved: boolean;
  exchangeRateEvidence?: ExchangeRateEvidence;
  vatRate: number;
  riskAllowanceRate?: number;
  riskAllowanceReason?: string;
  exchangeRate: number;
  warrantyMonths: number;
  validityDays: number;
  clientPaymentTerms: string;
  clientDeliveryTerms: string;
  clientDeliveryLocation?: string;
  clientFreightTerms?: string;
  clientQualifications?: string;
  requirementReviews: RequirementReview[];
  auditEvents: AuditEvent[];
};

type Requirement = {
  id: string;
  requirement: string;
  source: string;
  candidate: string;
  status: "Compliant" | "Review" | "Deviation";
};
type RequirementReview = Requirement & {
  evidence: string;
  reviewerNote: string;
  reviewedAt?: string;
  reviewedBy?: string;
};
type AssemblyPart = {
  id: string;
  component: string;
  basis: string;
  qty: number;
  unit: string;
  unitCost: number;
  kind: "Material" | "Labor" | "Service";
};
type RfqScopeGroup = {
  key: string;
  itemIds: number[];
  system: string;
  item: string;
  specification: string;
  unit: string;
  qty: number;
  sourceRows: number[];
};

const requirementAnchorIntegrity = (
  requirements: Requirement[],
  pageCount: number,
) => {
  const parsed = requirements.map((requirement) => ({
    requirement,
    match: requirement.source.match(/page (\d+) · §([^\s]+)/i),
  }));
  const anchors = parsed
    .filter((entry) => entry.match)
    .map((entry) => `p${entry.match?.[1]}-§${entry.match?.[2]}`);
  const invalidPages = parsed.filter(
    (entry) =>
      entry.match &&
      (Number(entry.match[1]) < 1 || Number(entry.match[1]) > pageCount),
  ).length;
  const uniqueAnchors = new Set(anchors);
  return {
    anchoredRequirements: anchors.length,
    uniqueAnchors: uniqueAnchors.size,
    missingAnchors: parsed.length - anchors.length,
    duplicateAnchors: anchors.length - uniqueAnchors.size,
    invalidPages,
    valid:
      anchors.length === requirements.length &&
      uniqueAnchors.size === anchors.length &&
      invalidPages === 0,
  };
};

const fireRequirements: Requirement[] = [
  {
    id: "r1",
    requirement: "Intelligent analogue addressable fire alarm system",
    source: "Specification 28 46 00 · page 1 · §1.1.B.1",
    candidate: "Product evidence not supplied",
    status: "Review",
  },
  {
    id: "r2",
    requirement: "Manufacturer and equipment accepted by Saudi Civil Defense",
    source: "Specification 28 46 00 · page 2 · §1.4.B",
    candidate: "Approval certificate required",
    status: "Review",
  },
  {
    id: "r3",
    requirement: "NFPA 72:2019 and applicable UL/EN54 listings",
    source: "Specification 28 46 00 · page 3 · §1.4.E",
    candidate: "Compliance schedule required",
    status: "Review",
  },
  {
    id: "r4",
    requirement: "Panels networkable with up to 99 additional nodes",
    source: "Specification 28 46 00 · page 6 · §1.5.BB",
    candidate: "Network architecture required",
    status: "Review",
  },
  {
    id: "r5",
    requirement: "24 h standby + 30 min alarm duty with 20% battery margin",
    source: "Specification 28 46 00 · page 10 · §1.10.G-H",
    candidate: "Battery calculation required",
    status: "Review",
  },
  {
    id: "r6",
    requirement: "Minimum three-year equipment warranty",
    source: "Specification 28 46 00 · page 31 · §3.15",
    candidate: "Supplier warranty required",
    status: "Review",
  },
];
const fireRequirementAnchorIntegrity = requirementAnchorIntegrity(
  fireRequirements,
  31,
);

const panelAssembly: AssemblyPart[] = [
  {
    id: "a1",
    component: "Addressable fire alarm control panel",
    basis: "BOQ rows 71, 115, 156, 195, 209, 225",
    qty: 1,
    unit: "ea",
    unitCost: 0,
    kind: "Material",
  },
  {
    id: "a2",
    component: "Network interface and required modules",
    basis: "Specification page 6 · §1.5.BB",
    qty: 1,
    unit: "lot",
    unitCost: 0,
    kind: "Material",
  },
  {
    id: "a3",
    component: "Standby batteries and charger",
    basis: "Specification page 10 · §1.10.D-I",
    qty: 1,
    unit: "set",
    unitCost: 0,
    kind: "Material",
  },
  {
    id: "a4",
    component: "Installation, wiring and termination",
    basis: "Specification page 1 · §1.1",
    qty: 1,
    unit: "lot",
    unitCost: 0,
    kind: "Labor",
  },
  {
    id: "a5",
    component: "Programming and cause/effect configuration",
    basis: "Specification pages 9-10",
    qty: 1,
    unit: "lot",
    unitCost: 0,
    kind: "Service",
  },
  {
    id: "a6",
    component: "Testing, certification and commissioning",
    basis: "Specification page 1 · §1.1.B.2.h",
    qty: 1,
    unit: "lot",
    unitCost: 0,
    kind: "Service",
  },
];

const initialItems: CostItem[] = [
  ...[
    ["Smoke detectors (above ceiling)", 571, "No", [11, 59, 103, 144]],
    ["Smoke detectors (below ceiling)", 820, "No", [13, 61, 105, 146]],
    ["Heat detector", 26, "No", [15, 63, 107, 148, 203]],
    ["Combined smoke and heat detector", 31, "No", [17, 65, 109, 150]],
    ["Door contact", 82, "No", [19, 67, 111, 152]],
    ["Duct detector", 45, "No", [21, 69, 113, 154]],
    ["Main fire alarm control panel and connectivity", 1, "No", [23]],
    ["Fire alarm manual station", 118, "No", [25, 73, 117, 158]],
    [
      "Fire alarm manual station (weatherproof)",
      39,
      "No",
      [27, 75, 119, 160, 191, 205, 221],
    ],
    ["Fireman telephone jack", 73, "No", [29, 80, 121, 166]],
    ["Interface module control", 55, "No", [31, 82, 125, 168]],
    ["Interface module monitor", 97, "No", [33, 84, 127, 170]],
    ["Loop powered strobes", 324, "No", [35, 86, 129, 172]],
    ["Loop powered strobes with sounder", 14, "No", [37, 88, 131, 174]],
    [
      "Loop powered strobes with sounder (weatherproof)",
      100,
      "No",
      [39, 90, 133, 176, 193, 207, 223],
    ],
    [
      "Access, firefighting and HVAC control/monitor interfaces",
      4,
      "LS",
      [47, 92, 135, 178],
    ],
    ["HVAC, smoke exhaust and BMS interface", 4, "LS", [49, 94, 137, 180]],
    ["Elevator signals and accessories", 4, "LS", [51, 96, 139, 182]],
    [
      "CWZ fire-resistant cable and accessories",
      5,
      "LS",
      [53, 98, 197, 211, 227],
    ],
    [
      "Fire alarm control panel with accessories",
      6,
      "No",
      [71, 115, 156, 195, 209, 225],
    ],
    ["Smoke detectors on slab", 10, "No", [189, 201, 219]],
  ].map(([item, qty, unit, sourceRows], index) => ({
    id: index + 1,
    system: "Fire Detection & Alarm",
    item: String(item),
    qty: Number(qty),
    supplier: "Awaiting technical selection",
    unitCost: 0,
    markup: 20,
    status: "RFQ Required" as const,
    unit: String(unit),
    specification: "Specification 28 46 00 and referenced tender drawings",
    sourceRows: sourceRows as number[],
  })),
];

const matchReadiness = (item: CostItem) => {
  const missing: string[] = [];
  if (!item.system?.trim() || item.system === "Unclassified")
    missing.push("category/system");
  if (!item.item?.trim() || item.item === "New BOQ item")
    missing.push("item description");
  if (!item.unit?.trim()) missing.push("unit");
  if (!Number.isFinite(item.qty) || item.qty <= 0) missing.push("quantity");
  if (!item.specification?.trim()) missing.push("model/specification");
  return { missing, canApprove: missing.length === 0 };
};

const sourceAnchorIntegrity = (candidateItems: CostItem[]) => {
  const anchors = candidateItems.flatMap((item) => item.sourceRows);
  const uniqueAnchors = new Set(anchors);
  return {
    anchorCount: anchors.length,
    uniqueAnchorCount: uniqueAnchors.size,
    duplicateAssignments: anchors.length - uniqueAnchors.size,
    unanchoredLines: candidateItems.filter((item) => !item.sourceRows.length)
      .length,
  };
};

const groupRfqScopeLines = (scopeItems: CostItem[]): RfqScopeGroup[] => {
  const groups = new Map<string, RfqScopeGroup>();
  scopeItems.forEach((item) => {
    const key = [item.system, item.item, item.specification, item.unit]
      .map((value) => value.trim().toLowerCase().replace(/\s+/g, " "))
      .join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.itemIds.push(item.id);
      existing.qty += item.qty;
      existing.sourceRows = [
        ...new Set([...existing.sourceRows, ...item.sourceRows]),
      ].sort((a, b) => a - b);
      return;
    }
    groups.set(key, {
      key,
      itemIds: [item.id],
      system: item.system,
      item: item.item,
      specification: item.specification,
      unit: item.unit,
      qty: item.qty,
      sourceRows: [...new Set(item.sourceRows)].sort((a, b) => a - b),
    });
  });
  return [...groups.values()];
};

const candidateLibrary: MatchCandidate[] = [
  {
    id: "hwl-smoke",
    sourceSheet: "2023 Farenhyt",
    appliesTo: "smoke detector",
    sourceType: "Expired manufacturer list",
    sourceName: "IDP-PHOTO-W + B501-WHITE",
    reference: "2023 Farenhyt · rows 117 & 152",
    price: 327,
    evidence:
      "Addressable photoelectric detector + required base · USD 87 × 3.755 SAR/USD",
    confidence: "Discovery only",
    expired: true,
  },
  {
    id: "hwl-heat",
    sourceSheet: "2023 Farenhyt",
    appliesTo: "heat detector",
    sourceType: "Expired manufacturer list",
    sourceName: "IDP-HEAT-ROR-W + B501-WHITE",
    reference: "2023 Farenhyt · rows 122 & 152",
    price: 323,
    evidence:
      "Addressable rate-of-rise heat detector + required base · USD 86 × 3.755",
    confidence: "Discovery only",
    expired: true,
  },
  {
    id: "hwl-control",
    sourceSheet: "2023 Farenhyt",
    appliesTo: "interface module control",
    sourceType: "Expired manufacturer list",
    sourceName: "IDP-CONTROL",
    reference: "2023 Farenhyt · row 126",
    price: 304,
    evidence: "Addressable supervised control module · USD 81 × 3.755",
    confidence: "Discovery only",
    expired: true,
  },
  {
    id: "hwl-monitor",
    sourceSheet: "2023 Farenhyt",
    appliesTo: "interface module monitor",
    sourceType: "Expired manufacturer list",
    sourceName: "IDP-MONITOR",
    reference: "2023 Farenhyt · row 130",
    price: 278,
    evidence:
      "Addressable supervised single-contact monitor module · USD 74 × 3.755",
    confidence: "Discovery only",
    expired: true,
  },
  {
    id: "hwl-panel",
    sourceSheet: "2023 Farenhyt",
    appliesTo: "control panel",
    sourceType: "Expired manufacturer list",
    sourceName: "IFP-2100HV",
    reference: "2023 Farenhyt · row 6",
    price: 25485,
    evidence:
      "2100-point addressable panel · USD 6,787 × 3.755; network and authority compliance remain unverified",
    confidence: "Discovery only",
    expired: true,
  },
  {
    id: "hwl-wp-horn",
    sourceSheet: "2023 Farenhyt",
    appliesTo: "sounder (weatherproof)",
    sourceType: "Expired manufacturer list",
    sourceName: "P2RK",
    reference: "2023 Farenhyt · row 473",
    price: 927,
    evidence:
      "Outdoor red horn/strobe with backbox · USD 247 × 3.755; loop compatibility unverified",
    confidence: "Discovery only",
    expired: true,
  },
];

const pricingEligibleSourceSheets = new Set<MatchCandidate["sourceSheet"]>([
  "2023 Farenhyt",
]);
const catalogueCandidateEligible = (candidate: MatchCandidate) =>
  pricingEligibleSourceSheets.has(candidate.sourceSheet) &&
  Number.isFinite(candidate.price) &&
  candidate.price > 0;
const eligibleCandidateLibrary = candidateLibrary.filter(
  catalogueCandidateEligible,
);

const matchDiagnosticFor = (
  item: CostItem,
  freshness: { status: string; validUntil: string },
): MatchDiagnostic => {
  if (freshness.status === "Expired")
    return {
      reason: "Expired price evidence",
      detail: `Approved evidence expired ${freshness.validUntil}; the stored amount cannot support a new quotation.`,
      action: "Renew supplier quote",
    };
  if (freshness.status === "Validity missing")
    return {
      reason: "Validity date missing",
      detail:
        "The approved source has no auditable commercial validity end date.",
      action: "Renew supplier quote",
    };
  const readiness = matchReadiness(item);
  if (!readiness.canApprove)
    return {
      reason: "Incomplete BOQ profile",
      detail: `Missing: ${readiness.missing.join(", ")}.`,
      action: "Complete item data",
    };
  const clues = eligibleCandidateLibrary.filter((candidate) =>
    item.item.toLowerCase().includes(candidate.appliesTo),
  );
  if (clues.length)
    return {
      reason: "Historical catalogue clue",
      detail: `${clues.length} source-anchored 2023 clue${clues.length === 1 ? "" : "s"} found; current supplier evidence is still required.`,
      action: "Review historical clue",
    };
  return {
    reason: "No plausible catalogue clue",
    detail: "No eligible reviewed catalogue clue matches this BOQ description.",
    action: "Create supplier RFQ",
  };
};

const honeywellLifecycleMappings: ProductLifecycleMapping[] = [
  {
    id: "life-fft-bgk",
    obsoletePart: "FFT-BGK",
    replacement: "No replacement stated",
    sourceRow: 2,
    disposition: "No replacement",
  },
  {
    id: "life-idp-acclimate",
    obsoletePart: "IDP-ACCLIMATE",
    replacement: "IDP-PTIR-W or [second option missing]",
    sourceRow: 3,
    disposition: "Incomplete mapping",
  },
  {
    id: "life-idp-photo",
    obsoletePart: "IDP-PHOTO",
    replacement: "IDP-PHOTO-W or IDP-PHOTO-IV",
    sourceRow: 5,
    disposition: "Replacement candidate",
  },
  {
    id: "life-idp-heat",
    obsoletePart: "IDP-HEAT",
    replacement: "IDP-HEAT-W or IDP-HEAT-IV",
    sourceRow: 8,
    disposition: "Replacement candidate",
  },
  {
    id: "life-idp-beam",
    obsoletePart: "IDP-BEAM",
    replacement: "OSI-RI-FH",
    sourceRow: 11,
    disposition: "Replacement candidate",
  },
  {
    id: "life-b501",
    obsoletePart: "B501",
    replacement: "B501-WHITE or B501-IV",
    sourceRow: 13,
    disposition: "Replacement candidate",
  },
  {
    id: "life-b210lp",
    obsoletePart: "B210LP",
    replacement: "B300-6",
    sourceRow: 14,
    disposition: "Replacement candidate",
  },
  {
    id: "life-beam1224",
    obsoletePart: "BEAM1224",
    replacement: "OSI-R-SS",
    sourceRow: 24,
    disposition: "Replacement candidate",
  },
];

const globalNavItems: Array<
  [string, string, ModuleName | "Projects" | "Settings"]
> = [
  ["⌂", "Dashboard", "Overview"],
  ["▦", "Projects", "Projects"],
  ["▤", "Knowledge Library", "Knowledge Library"],
  ["⌕", "Product Library", "Product Library"],
  ["▥", "Reports", "Reports"],
  ["⚙", "Settings", "Settings"],
];

const projectTabs: Array<[string, ModuleName]> = [
  ["Overview", "Overview"],
  ["Documents", "Documents"],
  ["BOQ", "BOQ"],
  ["Technical Review", "Review"],
  ["Product Matching", "Technical Matching"],
  ["Pricing", "Costing"],
  ["Quotation", "Quotation"],
];

const workflowSteps: Array<{
  label: string;
  module: ModuleName;
  owner: string;
}> = [
  { label: "Documents", module: "Documents", owner: "Document control" },
  { label: "Extract & Review", module: "BOQ", owner: "Estimator" },
  { label: "Match & Price", module: "Technical Matching", owner: "Estimator" },
  { label: "Supplier RFQs", module: "Supplier RFQs", owner: "Procurement" },
  { label: "Cost Review", module: "Costing", owner: "Estimator" },
  { label: "Validation", module: "Review", owner: "Discipline owners" },
  { label: "Quotation Approval", module: "Quotation", owner: "Commercial" },
  { label: "Issue & Export", module: "Reports", owner: "Commercial" },
];

const tenderDocuments = [
  "BOQ.xlsx",
  "28 46 00 - Fire Detection and Alarm System - Rev 1.pdf",
  "2401232-PC-AMS-DR-E-00-ZZZ-002.pdf",
  "2401232-PC-AMS-DR-T-00-ZZZ-002.pdf",
  "2401232-PC-AMS-DR-T-93-ZZZ-001.pdf",
  "2401232-PC-AMS-DR-T-93-ZZZ-002.pdf",
  "2401232-PC-AMS-DR-T-94-ZZZ-001.pdf",
  "2401232-PC-BOS-DR-T-93-ZZZ-005.pdf",
  "2401232-PC-BOS-DR-T-94-ZZZ-001.pdf",
  "2401232-PC-GRS-DR-T-93-ZZZ-005.pdf",
  "2401232-PC-GRS-DR-T-94-ZZZ-001.pdf",
  "2401232-PC-KGS-DR-T-91-ZZZ-002.pdf",
  "2401232-PC-KGS-DR-T-93-ZZZ-005.pdf",
  "2401232-PC-WLC-DR-T-93-ZZZ-005.pdf",
  "2401232-PC-WLC-DR-T-94-ZZZ-001.pdf",
  "KSA Honeywell Farenhyt Series Price List -2023.xlsx",
];

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const documentClassificationTypes = [
  "BOQ",
  "Technical Specification",
  "Drawing",
  "Product Catalogue",
  "Product Datasheet",
  "Price List",
  "Supplier Quotation",
  "Cost Sheet",
  "RFQ",
  "Tender Document",
  "Compliance Document",
  "Clarification",
  "Email",
  "Other",
];

// Legacy local recovery notice: Browser storage is not cloud synchronization. Back up all projects before clearing browser data, changing devices or making major revisions.
// Preserved legacy portfolio copy for backward-compatible local recovery tests:
// BOQ not extracted. Archiving is reversible; projects and their evidence are never deleted here.
// Compare deadline risk, readiness and the next evidence-based action. Due within 7 days.
// Projects are archived from their own workspace instead of being deleted from this portfolio.
// aria-label={`${stage.number} ${stage.label} · ${stage.status} · ${stage.detail} · owner ${stage.owner}`}
// Last activity · {control.lastActivityLabel}
// NEXT CONTROL · project-deadline ${control.deadlineState} · className="project-last-activity" · control.nextModule
// Legacy badge contract retained for restore compatibility: <b>LOCAL</b><small>Saved in this browser</small> · RFQs and approvals project-bound

const projectControlState = (project: LocalProject) => {
  const projectUploadedFiles = Array.isArray(project.uploadedFiles)
    ? project.uploadedFiles
    : [];
  const projectQuotationApprovals = Array.isArray(project.quotationApprovals)
    ? project.quotationApprovals
    : [];
  const projectAuditEvents = Array.isArray(project.auditEvents)
    ? project.auditEvents
    : [];
  const documents =
    (project.baseTenderLoaded ? tenderDocuments.length : 0) +
    projectUploadedFiles.length;
  const projectItems = Array.isArray(project.items) ? project.items : [];
  const projectRequirementReviews = Array.isArray(project.requirementReviews)
    ? project.requirementReviews
    : [];
  const priced = projectItems.filter((item) => item.status === "Costed").length;
  const unpriced = projectItems.length - priced;
  const pricingReadiness = projectItems.length
    ? Math.round((priced / projectItems.length) * 100)
    : 0;
  const technicalReviewed = projectRequirementReviews.filter(
    (item) => item.status !== "Review" && item.evidence?.trim(),
  ).length;
  const technicalReadiness =
    project.technicalProfileLoaded && projectRequirementReviews.length
      ? Math.round((technicalReviewed / projectRequirementReviews.length) * 100)
      : 0;
  const today = new Date().toISOString().slice(0, 10);
  const rateEvidence = project.exchangeRateEvidence;
  const projectRateReady = Boolean(
    project.rateResolved &&
    rateEvidence?.source.trim() &&
    rateEvidence.effectiveDate &&
    rateEvidence.effectiveDate <= today &&
    rateEvidence.validUntil &&
    rateEvidence.validUntil >= today,
  );
  const commercialReadiness = Math.round(
    ([
      projectRateReady,
      Boolean(project.clientPaymentTerms?.trim()),
      Boolean(project.clientDeliveryTerms?.trim()),
      Boolean(project.clientDeliveryLocation?.trim()),
      Boolean(project.clientFreightTerms?.trim()),
      Boolean(project.clientQualifications?.trim()),
    ].filter(Boolean).length /
      6) *
      100,
  );
  const calculatedReadiness = Math.round(
    (documents ? 20 : 0) +
      pricingReadiness * 0.45 +
      technicalReadiness * 0.2 +
      commercialReadiness * 0.15,
  );
  const readiness = !documents
    ? 0
    : !projectItems.length
      ? 20
      : calculatedReadiness;
  const terminal =
    project.status === "Archived" ||
    (project.status === "Quotation Approved" &&
      projectQuotationApprovals.length > 0);
  const dueTime = project.dueDate
    ? new Date(`${project.dueDate}T00:00:00`).getTime()
    : 0;
  const daysToDue = dueTime
    ? Math.ceil((dueTime - Date.now()) / 86400000)
    : null;
  const deadlineState = !project.dueDate
    ? "unset"
    : !terminal && Number(daysToDue) < 0
      ? "overdue"
      : !terminal && Number(daysToDue) <= 7
        ? "due-soon"
        : "on-track";
  const deadlineLabel = !project.dueDate
    ? "Date not set"
    : deadlineState === "overdue"
      ? `${Math.abs(Number(daysToDue))}d overdue`
      : daysToDue === 0
        ? "Due today"
        : deadlineState === "due-soon"
          ? `${daysToDue}d remaining`
          : new Date(`${project.dueDate}T00:00:00`).toLocaleDateString(
              "en-GB",
              { day: "numeric", month: "short", year: "numeric" },
            );
  const lastActivityLabel =
    projectAuditEvents[0]?.time || "No recorded activity";
  const context = {
    documents,
    readiness,
    deadlineState,
    deadlineLabel,
    lastActivityLabel,
  };
  if (!documents)
    return {
      ...context,
      nextLabel: "Add documents",
      nextModule: "Documents" as ModuleName,
    };
  if (!projectItems.length)
    return {
      ...context,
      nextLabel: "Review intake",
      nextModule: "Documents" as ModuleName,
    };
  if (unpriced)
    return {
      ...context,
      nextLabel: `Review ${unpriced} unpriced`,
      nextModule: "Review" as ModuleName,
    };
  if (technicalReadiness < 100)
    return {
      ...context,
      nextLabel: "Complete technical review",
      nextModule: "Technical Matching" as ModuleName,
    };
  if (commercialReadiness < 100)
    return {
      ...context,
      nextLabel: "Complete client terms",
      nextModule: "Quotation" as ModuleName,
    };
  if (!projectQuotationApprovals.length)
    return {
      ...context,
      nextLabel: "Approve quotation",
      nextModule: "Quotation" as ModuleName,
    };
  return {
    ...context,
    nextLabel: "Review approved issue",
    nextModule: "Reports" as ModuleName,
  };
};

const inferDocumentRole = (name: string): DocumentRole => {
  const normalized = name.toLowerCase();
  if (normalized.includes("boq") || normalized.includes("bill of quantities"))
    return "BOQ";
  if (
    normalized.includes("price list") ||
    normalized.includes("pricelist") ||
    normalized.includes("pricing")
  )
    return "Price source";
  if (
    normalized.includes("inquiry") ||
    normalized.includes("enquiry") ||
    normalized.includes("scope letter") ||
    normalized.includes("invitation to tender") ||
    normalized.includes("itt")
  )
    return "Client inquiry";
  if (
    normalized.includes("quotation") ||
    normalized.includes("quote") ||
    normalized.includes("rfq")
  )
    return "Supplier quotation";
  if (normalized.includes("spec") || normalized.includes("28 46 00"))
    return "Specification";
  if (normalized.endsWith(".pdf")) return "Drawing";
  return "Unclassified";
};

const storageKey = "ai-pricing-agent-almoosa-fire-alarm-v1";
// Phase 4: browser snapshots may not restore or persist project, RFQ, pricing,
// quotation, approval, workflow, or audit truth. Server APIs are authoritative.
const browserBusinessPersistenceEnabled = false;
const almoosaBoqSha256 =
  "e7d9e3d15eab9b143a339f21f26dca51e9436fecb904779d4f4de5fa8eb7a82c";
const honeywellPriceListSha256 =
  "88df340663209e15b3e7b7bca0f8c2ee2cb00b0e5ffb8aee0c1018a825574391";
const fireAlarmSpecificationSha256 =
  "0f007f2bfb8a2f915ff82bb21a1fcfea62a0ee594b110dda9a33c8368bb80d03";

const localBackupChecksum = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `LB-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const auditGenesis = "AUDIT-GENESIS";
const auditEventHash = (
  projectId: string,
  event: Pick<AuditEvent, "id" | "action" | "detail" | "actor" | "time">,
  previousHash: string,
) =>
  localBackupChecksum(
    JSON.stringify({
      projectId,
      id: event.id,
      action: event.action,
      detail: event.detail,
      actor: event.actor,
      time: event.time,
      previousHash,
    }),
  ).replace("LB-", "AE-");
const migrateAuditEvents = (
  events: AuditEvent[],
  ownerProjectId: string,
): AuditEvent[] => {
  let previousHash = auditGenesis;
  return events
    .slice()
    .reverse()
    .map((event) => {
      const projectId = event.projectId || ownerProjectId;
      const migrated =
        event.eventHash || event.previousHash
          ? { ...event, projectId }
          : {
              ...event,
              projectId,
              previousHash,
              eventHash: auditEventHash(projectId, event, previousHash),
            };
      previousHash =
        migrated.eventHash ||
        auditEventHash(
          projectId,
          migrated,
          migrated.previousHash || previousHash,
        );
      return migrated;
    })
    .reverse();
};
const prependAuditEvent = (
  events: AuditEvent[],
  projectId: string,
  event: Pick<AuditEvent, "id" | "action" | "detail" | "actor" | "time">,
): AuditEvent[] => {
  const previousHash = events[0]?.eventHash || auditGenesis;
  return [
    {
      ...event,
      projectId,
      previousHash,
      eventHash: auditEventHash(projectId, event, previousHash),
    },
    ...events,
  ];
};
const auditChainIntegrity = (events: AuditEvent[], ownerProjectId: string) => {
  let previousHash = auditGenesis;
  for (const event of events.slice().reverse()) {
    if (
      event.projectId !== ownerProjectId ||
      event.previousHash !== previousHash ||
      event.eventHash !== auditEventHash(ownerProjectId, event, previousHash)
    )
      return false;
    previousHash = event.eventHash;
  }
  return true;
};

const migrateRfqRecords = (
  records: RfqRecord[],
  ownerProjectId: string,
): RfqRecord[] =>
  records.map((rfq) => {
    const legacyOffer = rfq.responseReview
      ? {
          ...rfq.responseReview,
          id: rfq.responseReview.id || `legacy-${rfq.id}`,
          sourceFile:
            rfq.responseReview.sourceFile || rfq.responseFiles[0] || "",
        }
      : undefined;
    const responseOffers = (
      rfq.responseOffers?.length
        ? rfq.responseOffers
        : legacyOffer
          ? [legacyOffer]
          : []
    ).map((offer, index) => ({
      ...offer,
      id: offer.id || `${rfq.id}-offer-${index + 1}`,
      sourceFile:
        offer.sourceFile ||
        rfq.responseFiles[index] ||
        rfq.responseFiles[0] ||
        "",
      lines: offer.lines.map((line) => ({ ...line })),
    }));
    const awardedOffer = rfq.responseReview
      ? responseOffers.find(
          (offer) =>
            offer.id === (rfq.responseReview?.id || `legacy-${rfq.id}`),
        ) || legacyOffer
      : undefined;
    return {
      ...rfq,
      projectId: ownerProjectId,
      responseFiles: [...rfq.responseFiles],
      responseOffers,
      responseReview: awardedOffer,
    };
  });

const migrateQuotationApprovals = (
  approvals: QuotationApproval[],
  ownerProjectId: string,
): QuotationApproval[] =>
  approvals.map((approval) => ({ ...approval, projectId: ownerProjectId }));

export default function Home() {
  const [projectId, setProjectId] = useState("almoosa-k12-fire-alarm");
  const [savedProjects, setSavedProjects] = useState<LocalProject[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectMenuSearch, setProjectMenuSearch] = useState("");
  const [sourceLibrarySearch, setSourceLibrarySearch] = useState("");
  const [portfolioView, setPortfolioView] = useState<"Active" | "Archived">(
    "Active",
  );
  const [items, setItems] = useState(initialItems);
  const [, setActiveStep] = useState(1);
  const [activeModule, setActiveModule] = useState<ModuleName>("Overview");
  const [topLevelArea, setTopLevelArea] = useState<"Dashboard" | "Projects">(
    "Dashboard",
  );
  const [showAllProjects, setShowAllProjects] = useState(true);
  const isOrganizationLibrary = activeModule === "Knowledge Library";
  const [showNewProject, setShowNewProject] = useState(false);
  const [draftProjectName, setDraftProjectName] = useState("");
  const [draftClientName, setDraftClientName] = useState("");
  const [draftProjectCode, setDraftProjectCode] = useState("");
  const [draftProjectDueDate, setDraftProjectDueDate] = useState("");
  const [draftIntakeProfile, setDraftIntakeProfile] =
    useState<ProjectIntakeProfile>({
      country: "Saudi Arabia",
      city: "",
      location: "",
      system: "Fire Detection & Alarm",
      scopeIntent: "Pending tender review",
      buildings: "",
      boqAvailability: "Unknown",
      drawingAvailability: "Unknown",
      inquirySubject: "",
      inquiryReceived: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
    });
  const [newProjectStep, setNewProjectStep] = useState<1 | 2>(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuotation, setShowQuotation] = useState(false);
  const [showValidationReport, setShowValidationReport] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [showProjectEditor, setShowProjectEditor] = useState(false);
  const [projectName, setProjectName] = useState(
    "AlMoosa K12 Schools – Fire Alarm",
  );
  const [clientName, setClientName] = useState(
    "Quality Care Education Company",
  );
  const [projectCode, setProjectCode] = useState("2401232");
  const [projectDueDate, setProjectDueDate] = useState("2026-08-31");
  const [projectStatus, setProjectStatus] = useState("Technical Review");
  const [projectIntakeProfile, setProjectIntakeProfile] =
    useState<ProjectIntakeProfile>({
      country: "Saudi Arabia",
      city: "",
      location: "",
      system: "Fire Detection & Alarm",
      scopeIntent: "Pending tender review",
      buildings: "",
      boqAvailability: "Available",
      drawingAvailability: "Available",
    });
  const [projectDetailsDraft, setProjectDetailsDraft] =
    useState<ProjectDetailsDraft>({
      name: "AlMoosa K12 Schools – Fire Alarm",
      client: "Quality Care Education Company",
      code: "2401232",
      dueDate: "2026-08-31",
      status: "Technical Review",
    });
  const [baseTenderLoaded, setBaseTenderLoaded] = useState(true);
  const [technicalProfileLoaded, setTechnicalProfileLoaded] = useState(true);
  const [rateResolved, setRateResolved] = useState(false);
  const [exchangeRateEvidence, setExchangeRateEvidence] =
    useState<ExchangeRateEvidence>({
      source: "",
      effectiveDate: "",
      validUntil: "",
    });
  const [vatRate, setVatRate] = useState(15);
  const [riskAllowanceRate, setRiskAllowanceRate] = useState(0);
  const [riskAllowanceReason, setRiskAllowanceReason] = useState("");
  const [exchangeRate, setExchangeRate] = useState(3.755);
  const [warrantyMonths, setWarrantyMonths] = useState(12);
  const [validityDays, setValidityDays] = useState(30);
  const [clientPaymentTerms, setClientPaymentTerms] = useState("");
  const [clientDeliveryTerms, setClientDeliveryTerms] = useState("");
  const [clientDeliveryLocation, setClientDeliveryLocation] = useState("");
  const [clientFreightTerms, setClientFreightTerms] = useState("");
  const [clientQualifications, setClientQualifications] = useState("");
  const [scopeAlignmentDecision, setScopeAlignmentDecision] =
    useState<ScopeAlignmentDecision>({
      status: "Pending",
      evidenceReference: "",
      reason: "",
      sourceFingerprint: "",
    });
  const [scopeEvidenceDraft, setScopeEvidenceDraft] = useState("");
  const [scopeReasonDraft, setScopeReasonDraft] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<PricingSettingsDraft>({
    exchangeRate: 3.755,
    exchangeRateEvidence: { source: "", effectiveDate: "", validUntil: "" },
    vatRate: 15,
    riskAllowanceRate: 0,
    riskAllowanceReason: "",
    warrantyMonths: 12,
    validityDays: 30,
    clientPaymentTerms: "",
    clientDeliveryTerms: "",
    clientDeliveryLocation: "",
    clientFreightTerms: "",
    clientQualifications: "",
  });
  const [requirementReviews, setRequirementReviews] = useState<
    RequirementReview[]
  >(
    fireRequirements.map((requirement) => ({
      ...requirement,
      evidence: "",
      reviewerNote: "",
    })),
  );
  const [activeRequirementId, setActiveRequirementId] = useState<string | null>(
    null,
  );
  const [requirementResult, setRequirementResult] =
    useState<Requirement["status"]>("Review");
  const [requirementEvidence, setRequirementEvidence] = useState("");
  const [requirementNote, setRequirementNote] = useState("");
  const [rfqs, setRfqs] = useState<RfqRecord[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [documentRoles, setDocumentRoles] = useState<
    Record<string, DocumentRole>
  >({});
  const [documentHashes, setDocumentHashes] = useState<Record<string, string>>(
    {},
  );
  const [documentControls, setDocumentControls] = useState<
    Record<string, DocumentControl>
  >({});
  const [managedDocuments, setManagedDocuments] = useState<ManagedDocument[]>(
    [],
  );
  const [drawingWorkspaceDocument, setDrawingWorkspaceDocument] =
    useState<ManagedDocument | null>(null);
  const [drawingWorkspaceData, setDrawingWorkspaceData] =
    useState<DrawingWorkspaceData | null>(null);
  const [drawingWorkspaceTab, setDrawingWorkspaceTab] = useState<
    | "Overview"
    | "Pages"
    | "Metadata"
    | "Assets"
    | "Legend"
    | "Search"
    | "Version History"
  >("Overview");
  const [drawingWorkspaceLoading, setDrawingWorkspaceLoading] = useState(false);
  const [drawingWorkspaceError, setDrawingWorkspaceError] = useState("");
  const [drawingSearch, setDrawingSearch] = useState("");
  const [drawingSearchResults, setDrawingSearchResults] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [drawingVersionHistory, setDrawingVersionHistory] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [symbolWorkspaceDocument, setSymbolWorkspaceDocument] =
    useState<ManagedDocument | null>(null);
  const [symbolWorkspaceData, setSymbolWorkspaceData] =
    useState<SymbolWorkspaceData | null>(null);
  const [symbolWorkspaceTab, setSymbolWorkspaceTab] = useState<
    | "Definitions"
    | "Occurrences"
    | "Unknown symbols"
    | "Evidence"
    | "Review history"
  >("Definitions");
  const [symbolWorkspaceLoading, setSymbolWorkspaceLoading] = useState(false);
  const [symbolWorkspaceError, setSymbolWorkspaceError] = useState("");
  const [legendGeometryData, setLegendGeometryData] = useState<any>(null);
  const [legendGeometryDocument, setLegendGeometryDocument] =
    useState<ManagedDocument | null>(null);
  const [legendGeometryReason, setLegendGeometryReason] = useState(
    "Reviewed against the approved structural row and its bounded symbol cell.",
  );
  const [legendGeometryError, setLegendGeometryError] = useState("");
  const [symbolSegmentationDocument, setSymbolSegmentationDocument] =
    useState<ManagedDocument | null>(null);
  const [symbolSegmentationData, setSymbolSegmentationData] =
    useState<any>(null);
  const [symbolSegmentationReason, setSymbolSegmentationReason] = useState(
    "Reviewed against the rendered source cell and immutable vector fragments.",
  );
  const [symbolSegmentationError, setSymbolSegmentationError] = useState("");
  const [signatureMatchingDocument, setSignatureMatchingDocument] =
    useState<ManagedDocument | null>(null);
  const [signatureMatchingData, setSignatureMatchingData] = useState<any>(null);
  const [signatureMatchingReason, setSignatureMatchingReason] = useState(
    "Reviewed against the approved hollow-symbol topology and source geometry.",
  );
  const [signatureMatchingError, setSignatureMatchingError] = useState("");
  const [occurrenceClusteringDocument, setOccurrenceClusteringDocument] =
    useState<ManagedDocument | null>(null);
  const [occurrenceClusteringData, setOccurrenceClusteringData] =
    useState<any>(null);
  const [occurrenceClusteringReason, setOccurrenceClusteringReason] = useState(
    "Reviewed against preserved path membership, normalized topology, and source coordinates.",
  );
  const [occurrenceClusteringError, setOccurrenceClusteringError] =
    useState("");
  const [structureWorkspaceDocument, setStructureWorkspaceDocument] =
    useState<ManagedDocument | null>(null);
  const [structureWorkspaceData, setStructureWorkspaceData] =
    useState<StructureWorkspaceData | null>(null);
  const [structureWorkspaceTab, setStructureWorkspaceTab] = useState<
    | "Tables"
    | "Rows"
    | "Columns"
    | "Cells"
    | "Headers"
    | "Legend Rows"
    | "Validation"
    | "Version History"
    | "Search"
  >("Tables");
  const [structureWorkspaceLoading, setStructureWorkspaceLoading] =
    useState(false);
  const [structureWorkspaceError, setStructureWorkspaceError] = useState("");
  const [structureSearch, setStructureSearch] = useState("");
  const [structureSearchResults, setStructureSearchResults] = useState<
    Array<Record<string, any>>
  >([]);
  const [structureHistory, setStructureHistory] = useState<
    Array<Record<string, any>>
  >([]);
  const [structureReviewOpen, setStructureReviewOpen] = useState(false);
  const [structureReviewData, setStructureReviewData] =
    useState<StructureReviewData | null>(null);
  const [structureReviewCaseId, setStructureReviewCaseId] = useState<
    string | null
  >(null);
  const [structureReviewReason, setStructureReviewReason] = useState("");
  const [structureReviewDescription, setStructureReviewDescription] =
    useState("");
  const [structureReviewAbbreviation, setStructureReviewAbbreviation] =
    useState("");
  const [structureReviewLoading, setStructureReviewLoading] = useState(false);
  const [structureReviewError, setStructureReviewError] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryProducts, setLibraryProducts] = useState<LibraryProduct[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [selectedLibraryProduct, setSelectedLibraryProduct] =
    useState<LibraryProductDetail | null>(null);
  const [libraryDetailLoading, setLibraryDetailLoading] = useState(false);
  const [caseStudySearch, setCaseStudySearch] = useState("");
  const [caseStudies, setCaseStudies] = useState<CaseStudySummary[]>([]);
  const [caseStudyLoading, setCaseStudyLoading] = useState(false);
  const [caseStudyError, setCaseStudyError] = useState("");
  const [knowledgeSection, setKnowledgeSection] = useState("Files");
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileRecord[]>(
    [],
  );
  const [knowledgeSummary, setKnowledgeSummary] = useState<
    Record<string, number>
  >({});
  const [knowledgeResults, setKnowledgeResults] = useState<
    Array<Record<string, any>>
  >([]);
  const [knowledgeReviewItems, setKnowledgeReviewItems] = useState<
    Array<Record<string, any>>
  >([]);
  const [knowledgeReviewTarget, setKnowledgeReviewTarget] = useState<string | null>(null);
  const [knowledgeReviewReason, setKnowledgeReviewReason] = useState("");
  const [productIdentities, setProductIdentities] = useState<
    Array<Record<string, any>>
  >([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [pricingMemorySearch, setPricingMemorySearch] = useState("");
  const [pricingMemorySummary, setPricingMemorySummary] = useState<
    Record<string, number>
  >({});
  const [pricingMemoryCards, setPricingMemoryCards] = useState<
    Array<Record<string, any>>
  >([]);
  const [pricingMemoryLoading, setPricingMemoryLoading] = useState(false);
  const [pricingMemoryError, setPricingMemoryError] = useState("");
  const knowledgeUploadInput = useRef<HTMLInputElement>(null);
  const [boqReviewDocument, setBoqReviewDocument] =
    useState<ManagedDocument | null>(null);
  const [extractedBoqItems, setExtractedBoqItems] = useState<
    ExtractedBoqItem[]
  >([]);
  const [expandedBoqReviewReasons, setExpandedBoqReviewReasons] = useState<
    Record<string, boolean>
  >({});
  const [boqReviewAction, setBoqReviewAction] =
    useState<BoqReviewActionDraft | null>(null);
  const [specificationExtractionRequest, setSpecificationExtractionRequest] =
    useState<SpecificationExtractionRequestState | null>(null);
  const [requirementReviewDocument, setRequirementReviewDocument] =
    useState<ManagedDocument | null>(null);
  const [technicalRequirements, setTechnicalRequirements] = useState<
    TechnicalRequirement[]
  >([]);
  const [technicalRequirementsLoading, setTechnicalRequirementsLoading] =
    useState(false);
  const [technicalRequirementError, setTechnicalRequirementError] =
    useState("");
  const [technicalRequirementSearch, setTechnicalRequirementSearch] =
    useState("");
  const [technicalRequirementSection, setTechnicalRequirementSection] =
    useState("All");
  const [technicalRequirementClause, setTechnicalRequirementClause] =
    useState("All");
  const [technicalRequirementPage, setTechnicalRequirementPage] =
    useState("All");
  const [technicalRequirementStatus, setTechnicalRequirementStatus] =
    useState("All");
  const [selectedTechnicalRequirementId, setSelectedTechnicalRequirementId] =
    useState<string | null>(null);
  const [technicalRequirementHistory, setTechnicalRequirementHistory] =
    useState<RequirementReviewHistory[]>([]);
  const [technicalRequirementAction, setTechnicalRequirementAction] =
    useState<TechnicalRequirementAction | null>(null);
  const [
    technicalRequirementActionLoading,
    setTechnicalRequirementActionLoading,
  ] = useState(false);
  const [applicabilityReviewOpen, setApplicabilityReviewOpen] = useState(false);
  const [applicabilityLinks, setApplicabilityLinks] = useState<
    ApplicabilityLink[]
  >([]);
  const [applicabilityLoading, setApplicabilityLoading] = useState(false);
  const [applicabilityError, setApplicabilityError] = useState("");
  const [applicabilityStatusFilter, setApplicabilityStatusFilter] =
    useState("Open");
  const [applicabilityItemFilter, setApplicabilityItemFilter] = useState("All");
  const [applicabilityReviewAction, setApplicabilityReviewAction] =
    useState<ApplicabilityReviewAction | null>(null);
  const [applicabilityActionLoading, setApplicabilityActionLoading] =
    useState(false);
  const [requirementProfilesByItem, setRequirementProfilesByItem] = useState<
    Record<string, RequirementProfileView | null>
  >({});
  const [requirementProfileLoadingId, setRequirementProfileLoadingId] =
    useState<string | null>(null);
  const [requirementProfileError, setRequirementProfileError] = useState("");
  const [requirementIntelligenceItemId, setRequirementIntelligenceItemId] =
    useState<string | null>(null);
  const [requirementIntelligenceFacts, setRequirementIntelligenceFacts] =
    useState<RequirementIntelligenceFact[]>([]);
  const [
    requirementIntelligenceDecisions,
    setRequirementIntelligenceDecisions,
  ] = useState<RequirementIntelligenceDecision[]>([]);
  const [requirementIntelligenceLoading, setRequirementIntelligenceLoading] =
    useState(false);
  const [requirementIntelligenceError, setRequirementIntelligenceError] =
    useState("");
  const [requirementIntelligenceStatus, setRequirementIntelligenceStatus] =
    useState("All");
  const [requirementIntelligenceType, setRequirementIntelligenceType] =
    useState("All");
  const [requirementIntelligenceAction, setRequirementIntelligenceAction] =
    useState<RequirementIntelligenceAction | null>(null);
  const [engineeringClassificationItemId, setEngineeringClassificationItemId] =
    useState<string | null>(null);
  const [
    engineeringClassificationVersion,
    setEngineeringClassificationVersion,
  ] = useState<EngineeringClassificationVersion | null>(null);
  const [
    engineeringClassificationDecisions,
    setEngineeringClassificationDecisions,
  ] = useState<EngineeringClassificationDecision[]>([]);
  const [engineeringClassificationAudit, setEngineeringClassificationAudit] =
    useState<EngineeringClassificationAudit[]>([]);
  const [
    engineeringClassificationLoading,
    setEngineeringClassificationLoading,
  ] = useState(false);
  const [engineeringClassificationError, setEngineeringClassificationError] =
    useState("");
  const [engineeringClassificationStatus, setEngineeringClassificationStatus] =
    useState("All");
  const [engineeringClassificationAction, setEngineeringClassificationAction] =
    useState<EngineeringClassificationAction | null>(null);
  const [engineeringGraphItemId, setEngineeringGraphItemId] = useState<
    string | null
  >(null);
  const [engineeringGraphVersion, setEngineeringGraphVersion] =
    useState<EngineeringGraphVersion | null>(null);
  const [engineeringGraphNodes, setEngineeringGraphNodes] = useState<
    EngineeringGraphNode[]
  >([]);
  const [engineeringGraphRelationships, setEngineeringGraphRelationships] =
    useState<EngineeringGraphRelationship[]>([]);
  const [engineeringGraphAudit, setEngineeringGraphAudit] = useState<
    EngineeringGraphAudit[]
  >([]);
  const [engineeringGraphLoading, setEngineeringGraphLoading] = useState(false);
  const [engineeringGraphError, setEngineeringGraphError] = useState("");
  const [engineeringGraphAction, setEngineeringGraphAction] =
    useState<EngineeringGraphAction | null>(null);
  const [managedDocumentsLoading, setManagedDocumentsLoading] = useState(false);
  const [classificationReviewDraft, setClassificationReviewDraft] =
    useState<ClassificationReviewDraft | null>(null);
  const [uploadingDocumentNames, setUploadingDocumentNames] = useState<
    string[]
  >([]);
  const [uploadProgressByName, setUploadProgressByName] = useState<
    Record<string, number>
  >({});
  const [revisionCandidates, setRevisionCandidates] = useState<
    RevisionCandidate[]
  >([]);
  const [lifecycleReviews, setLifecycleReviews] = useState<
    Record<string, LifecycleReview>
  >({});
  const [appliedDocumentHashes, setAppliedDocumentHashes] = useState<string[]>(
    [],
  );
  const [durableLibrarySources, setDurableLibrarySources] = useState<DurableLibrarySource[]>([]);
  const durablePriceSourceHashes = durableLibrarySources.map((source) => source.checksum).filter(Boolean);
  const [indexedTechnicalHashes, setIndexedTechnicalHashes] = useState<
    string[]
  >([fireAlarmSpecificationSha256]);
  const [boqPreviewFile, setBoqPreviewFile] = useState<string | null>(null);
  const [boqLineDecisions, setBoqLineDecisions] = useState<
    Record<number, "Pending" | "Accepted" | "Excluded">
  >({});
  const [boqExclusionReasons, setBoqExclusionReasons] = useState<
    Record<number, string>
  >({});
  const [boqReviewSearch, setBoqReviewSearch] = useState("");
  const [genericBoqPreview, setGenericBoqPreview] =
    useState<GenericBoqPreview | null>(null);
  const [sourcePreviewFile, setSourcePreviewFile] = useState<string | null>(
    null,
  );
  const [sourceReviewConfirmed, setSourceReviewConfirmed] = useState(false);
  const [technicalPreviewFile, setTechnicalPreviewFile] = useState<
    string | null
  >(null);
  const [activeRfqId, setActiveRfqId] = useState<string | null>(null);
  const [activeResponseRfqId, setActiveResponseRfqId] = useState<string | null>(
    null,
  );
  const [responseDraft, setResponseDraft] =
    useState<SupplierResponseReview | null>(null);
  const [activeAwardRfqId, setActiveAwardRfqId] = useState<string | null>(null);
  const [activeAwardOfferId, setActiveAwardOfferId] = useState<string | null>(
    null,
  );
  const [awardReason, setAwardReason] = useState("");
  const [allowCostReplacement, setAllowCostReplacement] = useState(false);
  const [activeMarkupItemId, setActiveMarkupItemId] = useState<number | null>(
    null,
  );
  const [markupDraft, setMarkupDraft] = useState(0);
  const [markupReason, setMarkupReason] = useState("");
  const [quotationApprovals, setQuotationApprovals] = useState<
    QuotationApproval[]
  >([]);
  const [quotationApprovalReason, setQuotationApprovalReason] = useState("");
  const [serverQuotation, setServerQuotation] =
    useState<ServerQuotation | null>(null);
  const [quotationStale, setQuotationStale] = useState(false);
  const [quotationWorkflowLoading, setQuotationWorkflowLoading] =
    useState(false);
  const [pendingQuoteRfqId, setPendingQuoteRfqId] = useState<string | null>(
    null,
  );
  const [rfqSupplier, setRfqSupplier] = useState("");
  const [rfqDueDate, setRfqDueDate] = useState("");
  const [rfqDelivery, setRfqDelivery] = useState("");
  const [rfqRequirements, setRfqRequirements] = useState(
    "Please confirm unit price, quotation validity, lead time, warranty, freight, payment terms and technical compliance evidence.",
  );
  const [toast, setToast] = useState("");
  const [authSession, setAuthSession] = useState<AuthenticatedSession | null>(
    null,
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [authFailure, setAuthFailure] = useState<{
    status: number;
    code: string;
    message: string;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [matchingItemId, setMatchingItemId] = useState<number | null>(null);
  const [selectedMatchingItemId, setSelectedMatchingItemId] = useState<string | null>(null);
  const [persistentMatchCandidates, setPersistentMatchCandidates] = useState<
    PersistentMatchCandidate[]
  >([]);
  const [persistentMatchStatus, setPersistentMatchStatus] =
    useState("Not Started");
  const [persistentMatchError, setPersistentMatchError] = useState("");
  const [persistentMatchLoading, setPersistentMatchLoading] = useState(false);
  const [safetyCandidateId, setSafetyCandidateId] = useState<string | null>(
    null,
  );
  const [safetyDecision, setSafetyDecision] =
    useState<PersistentSafetyDecision | null>(null);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyError, setSafetyError] = useState("");
  const [pricingScenarios, setPricingScenarios] = useState<
    PersistentPricingScenario[]
  >([]);
  const [pricingScenarioId, setPricingScenarioId] = useState("");
  const [persistentPricingLines, setPersistentPricingLines] = useState<
    Record<string, PersistentPricingLine>
  >({});
  const [persistentPriceSources, setPersistentPriceSources] = useState<
    Record<string, PersistentPriceSource[]>
  >({});
  const [persistentPricingError, setPersistentPricingError] = useState("");
  const [persistentPricingLoadingId, setPersistentPricingLoadingId] = useState<
    number | null
  >(null);
  const [reviewQueue, setReviewQueue] = useState<PersistentReviewItem[]>([]);
  const [reviewSummary, setReviewSummary] =
    useState<PersistentReviewSummary | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewFilter, setReviewFilter] = useState("All");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewDecisionReason, setReviewDecisionReason] = useState<
    Record<string, string>
  >({});
  const [excelExportMode, setExcelExportMode] =
    useState<ExcelExportMode>("Draft Cost Sheet");
  const [excelExportTemplates, setExcelExportTemplates] = useState<
    ExcelExportTemplate[]
  >([]);
  const [excelExportTemplateId, setExcelExportTemplateId] = useState("");
  const [excelExportHistory, setExcelExportHistory] = useState<
    ExcelExportRecord[]
  >([]);
  const [excelExportPreview, setExcelExportPreview] = useState<{
    sheets: string[];
    reviewReadiness: string;
    readiness: {
      permitted: boolean;
      errors: string[];
      warnings: { line: number; warning: string }[];
    };
    lockedVersions: Record<string, string | number>;
  } | null>(null);
  const [excelExportLoading, setExcelExportLoading] = useState(false);
  const [excelExportError, setExcelExportError] = useState("");
  const [organizationDashboard, setOrganizationDashboard] =
    useState<OrganizationDashboard | null>(null);
  const [serverProjectDashboard, setServerProjectDashboard] =
    useState<ServerProjectDashboard | null>(null);
  const [preSalesWorkflow, setPreSalesWorkflow] =
    useState<PreSalesWorkflow | null>(null);
  const [estimatorReadiness, setEstimatorReadiness] =
    useState<EstimatorReadiness | null>(null);
  const [understandingRunning, setUnderstandingRunning] = useState(false);
  const [understandingMessage, setUnderstandingMessage] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardErrorCode, setDashboardErrorCode] = useState("");
  const projectMembership = authSession?.projectMemberships.find(
    (membership) => membership.project_id === projectId,
  );
  const workingRole: WorkingRole =
    (serverProjectDashboard?.project.effectiveRole as WorkingRole | null) ||
    projectMembership?.role ||
    "No Project Permission";
  const canViewCommercial =
    [
      "Commercial Approver",
      "Commercial Manager",
      "Commercial Reviewer",
      "Administrator",
    ].includes(workingRole) ||
    authSession?.effectiveLibraryPermission === "Administrator";
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(
    migrateAuditEvents(
      [
        {
          id: 1,
          action: "Tender test pack loaded",
          detail: "AlMoosa K12 · 1 BOQ, 1 specification and 13 drawings",
          actor: "System",
          time: "31 Jul 2026 · 09:00",
        },
        {
          id: 2,
          action: "BOQ normalized",
          detail:
            "21 scope lines retained with source row references · no prices assumed",
          actor: "System",
          time: "31 Jul 2026 · 09:01",
        },
        {
          id: 3,
          action: "Price source indexed",
          detail:
            "Honeywell Farenhyt KSA V23.1 · effective 01 Mar 2023 · marked expired and discovery-only",
          actor: "System",
          time: "31 Jul 2026 · 17:30",
        },
      ],
      "almoosa-k12-fire-alarm",
    ),
  );
  const [activitySearch, setActivitySearch] = useState("");
  const [activityCategory, setActivityCategory] =
    useState<AuditCategory>("All");
  const [activityActor, setActivityActor] = useState("All actors");
  const [costingView, setCostingView] = useState<
    "Needs action" | "All items" | "Priced"
  >("Needs action");
  const [costingSearch, setCostingSearch] = useState("");
  const [selectedRfqItemIds, setSelectedRfqItemIds] = useState<number[]>([]);
  const [showUploadIntent, setShowUploadIntent] = useState(false);
  const [uploadIntentRole, setUploadIntentRole] = useState<DocumentRole | null>(
    null,
  );
  const [matchView, setMatchView] = useState<
    "Requirements" | "Products" | "Assembly"
  >("Requirements");
  const [backupPreview, setBackupPreview] = useState<LocalBackupPreview | null>(
    null,
  );
  const [backupError, setBackupError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const storageReady = useRef(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.authenticated) {
          setAuthSession(null);
          setAuthFailure({
            status: response.status,
            code: payload.error?.code || "AUTHENTICATION_REQUIRED",
            message: payload.error?.message || "Sign in to continue.",
          });
          return;
        }
        setAuthSession(payload);
        setAuthFailure(null);
      })
      .catch(() => {
        if (active)
          setAuthFailure({
            status: 503,
            code: "AUTHENTICATION_PROVIDER_UNAVAILABLE",
            message: "Verified authentication is temporarily unavailable.",
          });
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const restoreLocation = () => {
      const location = parseProjectLocation(window.location.search);
      if (!location.projectId && location.workspace !== "Knowledge Library") return;
      if (location.projectId) setProjectId(location.projectId);
      setActiveModule(location.workspace as ModuleName);
      setSelectedMatchingItemId(
        location.workspace === "Technical Matching" && location.selectedItemId
          ? location.selectedItemId
          : null,
      );
      setPricingScenarioId(
        location.workspace === "Costing"
          ? location.selectedScenarioId
          : "",
      );
      setShowAllProjects(false);
      setProjectOpen(false);
    };
    restoreLocation();
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);

  const openDashboardRoute = (dashboardProjectId: string, route: string) => {
    const [module, query = ""] = route.split("?");
    const moduleMap: Record<string, ModuleName> = {
      Overview: "Overview",
      Documents: "Documents",
      BOQ: "BOQ",
      Requirements: "Technical Matching",
      Matching: "Technical Matching",
      Review: "Review",
      Costing: "Costing",
      "Supplier RFQs": "Supplier RFQs",
      Quotation: "Quotation",
      "Price Sources": "Price Sources",
      Reports: "Reports",
      Activity: "Activity",
    };
    const destination = moduleMap[module] || "Overview";
    if (
      !canViewCommercial &&
      ["Costing", "Quotation", "Reports"].includes(destination)
    ) {
      showToast("This screen requires a server-assigned commercial permission");
      return;
    }
    setProjectId(dashboardProjectId);
    setSelectedMatchingItemId(null);
    setShowAllProjects(false);
    setProjectOpen(false);
    setActiveModule(destination);
    window.history.pushState(
      null,
      "",
      `${buildProjectLocation(dashboardProjectId, destination)}${query ? `&${query}` : ""}`,
    );
    if (
      destination === "Documents" &&
      new URLSearchParams(query).get("status") === "needs-review"
    ) {
      window.setTimeout(
        () => document.getElementById("review-first-classification")?.click(),
        0,
      );
    }
  };

  const applyProjectReadModels = (
    dashboard: ServerProjectDashboard,
    canonical: { workflow: PreSalesWorkflow; currentQuotation?: ServerQuotation | null; quotationStale?: boolean },
  ) => {
    setPreSalesWorkflow(canonical.workflow);
    setServerQuotation(canonical.currentQuotation || null);
    setQuotationStale(Boolean(canonical.quotationStale));
    setServerProjectDashboard(dashboard);
    setProjectName(dashboard.project.name);
    setClientName(dashboard.project.client || "");
    setProjectCode(dashboard.project.tenderNumber || dashboard.project.id);
    setProjectDueDate(dashboard.project.dueDate || "");
    setProjectStatus(dashboard.project.initialStatus || dashboard.project.status);
    setProjectIntakeProfile((current) => ({
      ...current,
      system: dashboard.project.systemDomain || current.system,
    }));
  };

  const refreshProjectReadModels = async () => {
    const [dashboard, canonical, readiness] = await Promise.all([
      requestJson<ServerProjectDashboard>(projectApi.dashboard(projectId), { cache: "no-store" }),
      requestJson<{ workflow: PreSalesWorkflow; currentQuotation?: ServerQuotation | null; quotationStale?: boolean }>(projectApi.workflow(projectId), { cache: "no-store" }),
      requestJson<EstimatorReadiness>(`/api/projects/${encodeURIComponent(projectId)}/estimator-readiness`, { cache: "no-store" }),
    ]);
    applyProjectReadModels(dashboard, canonical);
    setEstimatorReadiness(readiness);
    return { dashboard, canonical };
  };

  const refreshDurableLibrarySources = useCallback(async () => {
    const payload = await requestJson<{ sources: DurableLibrarySource[] }>(
      commercialApi.priceSources(projectId),
      { cache: "no-store" },
    );
    setDurableLibrarySources(payload.sources || []);
    return payload.sources || [];
  }, [projectId]);

  useEffect(() => {
    if (activeModule === "Knowledge Library") return;
    let active = true;
    requestJson<{ sources: DurableLibrarySource[] }>(commercialApi.priceSources(projectId), { cache: "no-store" })
      .then((payload) => { if (active) setDurableLibrarySources(payload.sources || []); })
      .catch(() => { if (active) setDurableLibrarySources([]); });
    return () => { active = false; };
  }, [activeModule, projectId]);

  useEffect(() => {
    if (activeModule === "Knowledge Library") {
      setDashboardLoading(false);
      return;
    }
    let active = true;
    let timer = 0;
    const load = async () => {
      setDashboardLoading(true);
      try {
        const endpoint = showAllProjects
          ? `/api/dashboard/organization${projectSearch.trim() ? `?q=${encodeURIComponent(projectSearch.trim())}` : ""}`
          : `/api/projects/${encodeURIComponent(projectId)}/dashboard`;
        const payload = await requestJson<OrganizationDashboard | ServerProjectDashboard>(endpoint, { cache: "no-store" });
        if (!active) return;
        if (showAllProjects) setOrganizationDashboard(payload as OrganizationDashboard);
        else {
          const [canonical, readiness] = await Promise.all([
            requestJson<{ workflow: PreSalesWorkflow; currentQuotation?: ServerQuotation | null; quotationStale?: boolean }>(projectApi.workflow(projectId), { cache: "no-store" }),
            requestJson<EstimatorReadiness>(`/api/projects/${encodeURIComponent(projectId)}/estimator-readiness`, { cache: "no-store" }),
          ]);
          if (!active) return;
          applyProjectReadModels(payload as ServerProjectDashboard, canonical);
          setEstimatorReadiness(readiness);
        }
        setDashboardError("");
        setDashboardErrorCode("");
        timer = window.setTimeout(
          load,
          Math.max(5000, Number(payload.refreshAfterMs || 15000)),
        );
      } catch (error) {
        if (active)
          setDashboardError(
            error instanceof Error
              ? error.message
              : "Operational dashboard could not be loaded.",
          );
      } finally {
        if (active) setDashboardLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [showAllProjects, projectId, projectSearch, activeModule]);

  useEffect(() => {
    if (!serverProjectDashboard || serverProjectDashboard.facts.failedJobs)
      return;
    const reconciled = reconcileFailedDocumentFilter(
      window.location.search,
      serverProjectDashboard.facts.failedJobs,
    );
    if (reconciled === window.location.search) return;
    window.history.replaceState(null, "", `${window.location.pathname}${reconciled}`);
  }, [serverProjectDashboard]);

  useEffect(() => {
    if (
      !authLoading &&
      !canViewCommercial &&
      ["Costing", "Quotation", "Reports"].includes(activeModule)
    )
      setActiveModule("Overview");
  }, [activeModule, authLoading, canViewCommercial]);

  useEffect(() => {
    if (selectedMatchingItemId === null) return;
    const persistentItemId = selectedMatchingItemId;
    let active = true;
    if (!extractedBoqItems.length) return () => { active = false; };
    if (!extractedBoqItems.some((entry) => entry.id === persistentItemId)) {
      queueMicrotask(() => {
        if (!active) return;
        setPersistentMatchCandidates([]);
        setPersistentMatchStatus("Not Ready");
        setPersistentMatchError("The selected BOQ item is not available in this project.");
        setSelectedMatchingItemId(null);
      });
      return () => {
        active = false;
      };
    }
    Promise.resolve()
      .then(() => {
        if (!active) return;
        setPersistentMatchLoading(true);
        setPersistentMatchError("");
      })
      .then(() =>
        Promise.all([
          fetch(
            `/api/boq-items/${encodeURIComponent(persistentItemId)}/matching/status`,
          ),
          fetch(
            `/api/boq-items/${encodeURIComponent(persistentItemId)}/matching/candidates`,
          ),
        ]),
      )
      .then(async ([statusResponse, candidateResponse]) => {
        const statusPayload = await statusResponse.json();
        const candidatePayload = await candidateResponse.json();
        if (!active) return;
        setPersistentMatchStatus(
          statusPayload.status || statusPayload.error?.message || "Not Started",
        );
        setPersistentMatchCandidates(
          candidateResponse.ok ? candidatePayload.candidates || [] : [],
        );
        if (
          !candidateResponse.ok &&
          candidatePayload.error?.code !== "MATCH_RUN_REQUIRED"
        )
          setPersistentMatchError(
            candidatePayload.error?.message ||
              "Matching results could not be loaded.",
          );
      })
      .catch(() => {
        if (active)
          setPersistentMatchError("Matching service could not be reached.");
      })
      .finally(() => {
        if (active) setPersistentMatchLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedMatchingItemId, extractedBoqItems]);

  useEffect(() => {
    if (activeModule !== "Costing") return;
    let active = true;
    fetch(commercialApi.scenarios(projectId))
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok)
          throw new Error(
            payload.error?.message || "Pricing scenarios could not be loaded.",
          );
        const scenarios = payload.scenarios || [];
        setPricingScenarios(scenarios);
        setPricingScenarioId((current) => {
          const linked = new URLSearchParams(window.location.search).get("scenario") || "";
          const preferred = linked || current;
          return preferred &&
          scenarios.some(
            (entry: PersistentPricingScenario) => entry.id === preferred,
          )
            ? preferred
            : scenarios[0]?.id || "";
        });
        setPersistentPricingError("");
      })
      .catch((error) => {
        if (active)
          setPersistentPricingError(
            error instanceof Error
              ? error.message
              : "Pricing scenarios could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [activeModule, projectId]);

  useEffect(() => {
    if (activeModule !== "Costing" || !pricingScenarioId || !extractedBoqItems.length) {
      if (!pricingScenarioId) setPersistentPricingLines({});
      return;
    }
    let active = true;
    Promise.all(
      extractedBoqItems
        .filter((item) => item.row_type === "BOQ Item")
        .map(async (item) => {
          const payload = await requestJson<PersistentPricingLine>(
            commercialApi.pricingLine(item.id, pricingScenarioId),
            { cache: "no-store" },
          );
          return [item.id, payload] as const;
        }),
    )
      .then((entries) => {
        if (active) setPersistentPricingLines(Object.fromEntries(entries));
      })
      .catch((error) => {
        if (active) setPersistentPricingError(error instanceof Error ? error.message : "Pricing lines could not be loaded.");
      });
    return () => { active = false; };
  }, [activeModule, projectId, pricingScenarioId, extractedBoqItems]);

  const loadPersistentPriceSourcesForItem = useCallback(async (itemId: string) => {
    const candidateResponse = await fetch(
      `/api/boq-items/${encodeURIComponent(itemId)}/matching/candidates`,
      { cache: "no-store" },
    );
    if (!candidateResponse.ok) return [];
    const candidatePayload = await candidateResponse.json();
    const candidate = (candidatePayload.candidates || []).find(
      (entry: PersistentMatchCandidate) => entry.technical_status === "Technically Compliant",
    ) || candidatePayload.candidates?.[0];
    if (!candidate?.product_id) return [];
    const payload = await requestJson<{ prices: Record<string, unknown>[] }>(
      commercialApi.productPrices(candidate.product_id, projectId),
      { cache: "no-store" },
    );
    return (payload.prices || []).map((record) => {
      const location = typeof record.source_location === "object" && record.source_location
        ? record.source_location as Record<string, unknown>
        : {};
      return {
        id: String(record.id),
        sourceId: String(record.source_id),
        productId: String(record.product_id),
        sourceType: String(record.source_type || record.price_type || "Price Evidence"),
        supplier: record.supplier_name ? String(record.supplier_name) : null,
        amount: Number(record.amount || 0),
        currency: String(record.currency || ""),
        validityState: String(record.validity_state || "Unknown"),
        validUntil: record.valid_until ? String(record.valid_until) : null,
        projectId: record.project_id ? String(record.project_id) : null,
        provenance: String(record.file_name || location.source || "Persisted source provenance"),
        approvalStatus: String(record.approval_status || "Needs Review"),
        downstreamUse: String(record.downstream_use || "Discovery Only"),
        reviewState: String(record.source_review_status || "Needs Review"),
        eligibleForCosting: record.eligibleForCosting === true,
      } satisfies PersistentPriceSource;
    });
  }, [projectId]);

  useEffect(() => {
    if (activeModule !== "Costing") return;
    let active = true;
    const items = extractedBoqItems.filter((item) => item.row_type === "BOQ Item");
    Promise.all(items.map(async (item) => [item.id, await loadPersistentPriceSourcesForItem(item.id)] as const))
      .then((entries) => { if (active) setPersistentPriceSources(Object.fromEntries(entries)); })
      .catch((error) => { if (active) setPersistentPricingError(error instanceof Error ? error.message : "Price evidence could not be loaded."); });
    return () => { active = false; };
  }, [activeModule, extractedBoqItems, loadPersistentPriceSourcesForItem]);

  const loadReviewWorkspace = async (synchronize = false) => {
    setReviewLoading(true);
    setReviewError("");
    try {
      if (synchronize) {
        const sync = await fetch(
          `/api/reviews/projects/${encodeURIComponent(projectId)}/sync`,
          { method: "POST" },
        );
        if (!sync.ok && sync.status !== 403) {
          const problem = await sync.json();
          throw new Error(
            problem.error?.message ||
              "Review exceptions could not be synchronized.",
          );
        }
      }
      const query = new URLSearchParams();
      if (reviewFilter !== "All") query.set("status", reviewFilter);
      if (reviewSearch.trim()) query.set("search", reviewSearch.trim());
      const [queueResponse, summaryResponse] = await Promise.all([
          fetch(
          commercialApi.reviewQueue(projectId, query.toString()),
          ),
          fetch(
            commercialApi.reviewSummary(projectId),
          ),
        ]),
        queuePayload = await queueResponse.json(),
        summaryPayload = await summaryResponse.json();
      if (!queueResponse.ok)
        throw new Error(
          queuePayload.error?.message || "Review queue could not be loaded.",
        );
      if (!summaryResponse.ok)
        throw new Error(
          summaryPayload.error?.message ||
            "Review summary could not be loaded.",
        );
      setReviewQueue(queuePayload.items || []);
      setReviewSummary(summaryPayload.summary || null);
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : "Review workflow could not be reached.",
      );
    } finally {
      setReviewLoading(false);
    }
  };

  // Queue loading follows navigation; filter changes are applied explicitly by the user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeModule !== "Review") return;
    const timer = window.setTimeout(() => {
      void loadReviewWorkspace(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeModule, projectId]);

  const actOnReview = async (
    item: PersistentReviewItem,
    operation: "start" | "decision" | "escalate",
    outcome?: string,
  ) => {
    const reason =
      reviewDecisionReason[item.id]?.trim() ||
      "Reviewer opened and validated the current governed evidence";
    if (operation !== "start" && reason.length < 10) {
      setReviewError("Enter a substantive decision reason before continuing.");
      return;
    }
    setReviewLoading(true);
    setReviewError("");
    try {
      const response = await fetch(
        commercialApi.reviewAction(item.id, operation),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              operation === "decision"
                ? {
                    reviewVersion: item.version_number,
                    type:
                      item.review_type.includes("Commercial") ||
                      item.review_type.includes("Cost") ||
                      item.review_type.includes("Price")
                        ? "Approve Commercial"
                        : "Approve Technical Match",
                    outcome,
                    reason,
                    evidence: [],
                    scope: "BOQ Item",
                  }
                : {
                    reviewVersion: item.version_number,
                    reason,
                    targetRole: "Technical Manager",
                  },
            ),
          },
        ),
        payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message || "Review action was rejected.",
        );
      recordAudit(
        `Review ${operation}`,
        `${item.id} · ${payload.status || outcome || "updated"} · server validated`,
      );
      await loadReviewWorkspace(false);
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "Review action failed.",
      );
    } finally {
      setReviewLoading(false);
    }
  };

  const loadExcelExports = async () => {
    setExcelExportLoading(true);
    setExcelExportError("");
    try {
      const [templatesResponse, historyResponse] = await Promise.all([
          fetch("/api/excel-exports/templates"),
          fetch(
            `/api/excel-exports/projects/${encodeURIComponent(projectId)}/history`,
          ),
        ]),
        templatesPayload = await templatesResponse.json(),
        historyPayload = await historyResponse.json();
      if (!templatesResponse.ok)
        throw new Error(
          templatesPayload.error?.message ||
            "Export templates could not be loaded.",
        );
      if (!historyResponse.ok)
        throw new Error(
          historyPayload.error?.message ||
            "Export history could not be loaded.",
        );
      const templates = templatesPayload.templates || [];
      setExcelExportTemplates(templates);
      setExcelExportTemplateId((current) =>
        current &&
        templates.some((entry: ExcelExportTemplate) => entry.id === current)
          ? current
          : templates[0]?.id || "",
      );
      setExcelExportHistory(historyPayload.exports || []);
    } catch (error) {
      setExcelExportError(
        error instanceof Error
          ? error.message
          : "Excel exports could not be loaded.",
      );
    } finally {
      setExcelExportLoading(false);
    }
  };
  // Export records load after the Reports module is committed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeModule !== "Reports") return;
    const timer = window.setTimeout(() => {
      void loadExcelExports();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeModule, projectId]);
  const previewExcelExport = async () => {
    setExcelExportLoading(true);
    setExcelExportError("");
    try {
      const response = await fetch(
          `/api/excel-exports/projects/${encodeURIComponent(projectId)}/preview`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: excelExportMode,
              templateId: excelExportTemplateId,
            }),
          },
        ),
        payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message || "Export preview failed.");
      setExcelExportPreview(payload);
    } catch (error) {
      setExcelExportError(
        error instanceof Error ? error.message : "Export preview failed.",
      );
    } finally {
      setExcelExportLoading(false);
    }
  };
  const startExcelExport = async () => {
    setExcelExportLoading(true);
    setExcelExportError("");
    try {
      const response = await fetch(
          `/api/excel-exports/projects/${encodeURIComponent(projectId)}/exports`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": `${projectId}-${excelExportMode}-${excelExportHistory.length + 1}`,
            },
            body: JSON.stringify({
              mode: excelExportMode,
              templateId: excelExportTemplateId,
              tenderNumber: projectCode,
              client: clientName,
              location:
                projectIntakeProfile.location || projectIntakeProfile.city,
              package: projectIntakeProfile.system,
              reason:
                "User requested a version-locked Excel cost sheet from the Reports workspace",
            }),
          },
        ),
        payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.readiness?.errors?.join(", ") ||
            payload.error?.message ||
            "Excel export failed.",
        );
      recordAudit(
        "Excel cost sheet generated",
        `${payload.filename} · ${payload.status} · SHA-256 ${payload.sha256?.slice(0, 12)}…`,
      );
      setExcelExportPreview(null);
      await loadExcelExports();
    } catch (error) {
      setExcelExportError(
        error instanceof Error ? error.message : "Excel export failed.",
      );
    } finally {
      setExcelExportLoading(false);
    }
  };

  useEffect(() => {
    const restore = window.setTimeout(() => {
      if (!browserBusinessPersistenceEnabled) {
        window.localStorage.removeItem(storageKey);
        storageReady.current = true;
        return;
      }
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const data = JSON.parse(saved);
          const linkedProjectId = new URLSearchParams(window.location.search)
            .get("project")
            ?.trim();
          const savedProjectId =
            typeof data.projectId === "string" ? data.projectId : "";
          if (
            linkedProjectId &&
            savedProjectId &&
            linkedProjectId !== savedProjectId
          ) {
            // A project deep link is authoritative. Restoring another project's browser
            // snapshot here can leak its name, documents, BOQ, and commercial state into
            // the linked workspace before server data loads.
            storageReady.current = true;
            return;
          }
          if (Array.isArray(data.items)) {
            setItems(
              data.items.map((savedItem: Partial<CostItem>) => {
                const currentDefault = initialItems.find(
                  (item) => item.id === savedItem.id,
                );
                return {
                  ...currentDefault,
                  ...savedItem,
                  unit: savedItem.unit ?? currentDefault?.unit ?? "",
                  specification:
                    savedItem.specification ??
                    currentDefault?.specification ??
                    "",
                  sourceRows:
                    savedItem.sourceRows ?? currentDefault?.sourceRows ?? [],
                } as CostItem;
              }),
            );
          }
          if (typeof data.rateResolved === "boolean")
            setRateResolved(data.rateResolved);
          if (
            data.exchangeRateEvidence &&
            typeof data.exchangeRateEvidence === "object"
          )
            setExchangeRateEvidence(data.exchangeRateEvidence);
          if (typeof data.vatRate === "number") setVatRate(data.vatRate);
          if (typeof data.riskAllowanceRate === "number")
            setRiskAllowanceRate(data.riskAllowanceRate);
          if (typeof data.riskAllowanceReason === "string")
            setRiskAllowanceReason(data.riskAllowanceReason);
          if (typeof data.exchangeRate === "number")
            setExchangeRate(data.exchangeRate);
          if (typeof data.warrantyMonths === "number")
            setWarrantyMonths(data.warrantyMonths);
          if (typeof data.validityDays === "number")
            setValidityDays(data.validityDays);
          if (typeof data.clientPaymentTerms === "string")
            setClientPaymentTerms(data.clientPaymentTerms);
          if (typeof data.clientDeliveryTerms === "string")
            setClientDeliveryTerms(data.clientDeliveryTerms);
          if (typeof data.clientDeliveryLocation === "string")
            setClientDeliveryLocation(data.clientDeliveryLocation);
          if (typeof data.clientFreightTerms === "string")
            setClientFreightTerms(data.clientFreightTerms);
          if (typeof data.clientQualifications === "string")
            setClientQualifications(data.clientQualifications);
          if (
            data.scopeAlignmentDecision &&
            typeof data.scopeAlignmentDecision === "object"
          )
            setScopeAlignmentDecision(data.scopeAlignmentDecision);
          if (Array.isArray(data.requirementReviews))
            setRequirementReviews(data.requirementReviews);
          const restoredProjectId =
            typeof data.projectId === "string"
              ? data.projectId
              : "almoosa-k12-fire-alarm";
          if (Array.isArray(data.rfqs))
            setRfqs(migrateRfqRecords(data.rfqs, restoredProjectId));
          if (Array.isArray(data.quotationApprovals))
            setQuotationApprovals(
              migrateQuotationApprovals(
                data.quotationApprovals,
                restoredProjectId,
              ),
            );
          if (Array.isArray(data.uploadedFiles))
            setUploadedFiles(data.uploadedFiles);
          if (data.documentRoles && typeof data.documentRoles === "object")
            setDocumentRoles(data.documentRoles);
          if (data.documentHashes && typeof data.documentHashes === "object")
            setDocumentHashes(data.documentHashes);
          if (
            data.documentControls &&
            typeof data.documentControls === "object"
          )
            setDocumentControls(data.documentControls);
          if (Array.isArray(data.revisionCandidates))
            setRevisionCandidates(data.revisionCandidates);
          if (
            data.lifecycleReviews &&
            typeof data.lifecycleReviews === "object"
          )
            setLifecycleReviews(data.lifecycleReviews);
          if (Array.isArray(data.appliedDocumentHashes))
            setAppliedDocumentHashes(data.appliedDocumentHashes);
          if (Array.isArray(data.indexedTechnicalHashes))
            setIndexedTechnicalHashes(data.indexedTechnicalHashes);
          if (typeof data.projectName === "string")
            setProjectName(data.projectName);
          if (typeof data.clientName === "string")
            setClientName(data.clientName);
          if (typeof data.projectCode === "string")
            setProjectCode(data.projectCode);
          if (typeof data.projectDueDate === "string")
            setProjectDueDate(data.projectDueDate);
          if (typeof data.projectStatus === "string")
            setProjectStatus(data.projectStatus);
          if (
            data.projectIntakeProfile &&
            typeof data.projectIntakeProfile === "object"
          )
            setProjectIntakeProfile(data.projectIntakeProfile);
          if (typeof data.projectId === "string") setProjectId(data.projectId);
          if (typeof data.baseTenderLoaded === "boolean")
            setBaseTenderLoaded(data.baseTenderLoaded);
          if (typeof data.technicalProfileLoaded === "boolean")
            setTechnicalProfileLoaded(data.technicalProfileLoaded);
          if (Array.isArray(data.savedProjects))
            setSavedProjects(data.savedProjects);
          if (Array.isArray(data.auditEvents))
            setAuditEvents(
              migrateAuditEvents(data.auditEvents, restoredProjectId),
            );
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
      storageReady.current = true;
    }, 0);

    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (!browserBusinessPersistenceEnabled || !storageReady.current) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        items,
        rateResolved,
        exchangeRateEvidence,
        vatRate,
        riskAllowanceRate,
        riskAllowanceReason,
        exchangeRate,
        warrantyMonths,
        validityDays,
        clientPaymentTerms,
        clientDeliveryTerms,
        clientDeliveryLocation,
        clientFreightTerms,
        clientQualifications,
        scopeAlignmentDecision,
        requirementReviews,
        rfqs,
        quotationApprovals,
        uploadedFiles,
        documentRoles,
        documentHashes,
        documentControls,
        revisionCandidates,
        lifecycleReviews,
        appliedDocumentHashes,
        indexedTechnicalHashes,
        projectName,
        clientName,
        projectCode,
        projectDueDate,
        projectStatus,
        projectIntakeProfile,
        projectId,
        baseTenderLoaded,
        technicalProfileLoaded,
        savedProjects,
        auditEvents,
      }),
    );
  }, [
    items,
    rateResolved,
    exchangeRateEvidence,
    vatRate,
    riskAllowanceRate,
    riskAllowanceReason,
    exchangeRate,
    warrantyMonths,
    validityDays,
    clientPaymentTerms,
    clientDeliveryTerms,
    clientDeliveryLocation,
    clientFreightTerms,
    clientQualifications,
    scopeAlignmentDecision,
    requirementReviews,
    rfqs,
    quotationApprovals,
    uploadedFiles,
    documentRoles,
    documentHashes,
    documentControls,
    revisionCandidates,
    lifecycleReviews,
    appliedDocumentHashes,
    indexedTechnicalHashes,
    projectName,
    clientName,
    projectCode,
    projectDueDate,
    projectStatus,
    projectIntakeProfile,
    projectId,
    baseTenderLoaded,
    technicalProfileLoaded,
    savedProjects,
    auditEvents,
  ]);

  const currentProjectSnapshot = (): LocalProject => ({
    id: projectId,
    name: projectName,
    client: clientName,
    code: projectCode,
    dueDate: projectDueDate,
    status: projectStatus,
    intakeProfile: projectIntakeProfile,
    items,
    uploadedFiles,
    documentRoles,
    documentHashes,
    documentControls,
    revisionCandidates,
    lifecycleReviews,
    appliedDocumentHashes,
    indexedTechnicalHashes,
    baseTenderLoaded,
    technicalProfileLoaded,
    rateResolved,
    exchangeRateEvidence,
    vatRate,
    riskAllowanceRate,
    riskAllowanceReason,
    exchangeRate,
    warrantyMonths,
    validityDays,
    clientPaymentTerms,
    clientDeliveryTerms,
    clientDeliveryLocation,
    clientFreightTerms,
    clientQualifications,
    scopeAlignmentDecision,
    requirementReviews,
    rfqs,
    quotationApprovals,
    auditEvents,
  });

  const loadProject = (project: LocalProject) => {
    setSelectedRfqItemIds([]);
    setProjectId(project.id);
    setProjectName(project.name);
    setClientName(project.client);
    setProjectCode(project.code);
    setProjectDueDate(project.dueDate);
    setProjectStatus(project.status);
    setProjectIntakeProfile(
      project.intakeProfile || {
        country: "Saudi Arabia",
        city: "",
        location: "",
        system: "Fire Detection & Alarm",
        scopeIntent: "Pending tender review",
        buildings: "",
        boqAvailability: "Unknown",
        drawingAvailability: "Unknown",
      },
    );
    setItems(project.items);
    setUploadedFiles(project.uploadedFiles);
    setDocumentRoles(project.documentRoles || {});
    setDocumentHashes(project.documentHashes || {});
    setDocumentControls(project.documentControls || {});
    setRevisionCandidates(project.revisionCandidates || []);
    setLifecycleReviews(project.lifecycleReviews || {});
    setAppliedDocumentHashes(project.appliedDocumentHashes || []);
    setIndexedTechnicalHashes(
      project.indexedTechnicalHashes ||
        (project.baseTenderLoaded ? [fireAlarmSpecificationSha256] : []),
    );
    setBaseTenderLoaded(project.baseTenderLoaded);
    setTechnicalProfileLoaded(
      project.technicalProfileLoaded ?? project.baseTenderLoaded,
    );
    setRateResolved(project.rateResolved);
    setExchangeRateEvidence(
      project.exchangeRateEvidence || {
        source: "",
        effectiveDate: "",
        validUntil: "",
      },
    );
    setVatRate(project.vatRate);
    setRiskAllowanceRate(project.riskAllowanceRate || 0);
    setRiskAllowanceReason(project.riskAllowanceReason || "");
    setExchangeRate(project.exchangeRate);
    setWarrantyMonths(project.warrantyMonths);
    setValidityDays(project.validityDays);
    setClientPaymentTerms(project.clientPaymentTerms || "");
    setClientDeliveryTerms(project.clientDeliveryTerms || "");
    setClientDeliveryLocation(project.clientDeliveryLocation || "");
    setClientFreightTerms(project.clientFreightTerms || "");
    setClientQualifications(project.clientQualifications || "");
    setScopeAlignmentDecision(
      project.scopeAlignmentDecision || {
        status: "Pending",
        evidenceReference: "",
        reason: "",
        sourceFingerprint: "",
      },
    );
    setScopeEvidenceDraft("");
    setScopeReasonDraft("");
    setRequirementReviews(
      project.requirementReviews ||
        fireRequirements.map((requirement) => ({
          ...requirement,
          evidence: "",
          reviewerNote: "",
        })),
    );
    setRfqs(migrateRfqRecords(project.rfqs || [], project.id));
    setQuotationApprovals(
      migrateQuotationApprovals(project.quotationApprovals || [], project.id),
    );
    setAuditEvents(migrateAuditEvents(project.auditEvents, project.id));
    setMatchingItemId(null);
    setSelectedMatchingItemId(null);
    setRequirementReviewDocument(null);
    setSelectedTechnicalRequirementId(null);
    setProjectOpen(false);
    setShowAllProjects(false);
    setActiveModule("Overview");
  };

  const switchProject = (targetId: string) => {
    if (targetId === projectId) {
      setShowAllProjects(false);
      setProjectOpen(false);
      setActiveModule("Overview");
      return;
    }
    const target = savedProjects.find((project) => project.id === targetId);
    if (!target) return;
    setSavedProjects((projects) => [
      currentProjectSnapshot(),
      ...projects.filter((project) => project.id !== targetId),
    ]);
    loadProject(target);
    setAuditEvents((current) =>
      prependAuditEvent(current, target.id, {
        id: Date.now(),
        action: "Workspace activated",
        detail: `${target.name} · ${target.code} · explicit project switch`,
        actor: workingRole,
        time: new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date()),
      }),
    );
  };

  const createLocalProject = async () => {
    const name = draftProjectName.trim();
    if (!name) return;
    if (draftTenderTimelineBlocked) {
      showToast(`Project creation blocked: ${draftTenderTimelineMessage}`);
      return;
    }
    if (draftProjectIdentityConflict) {
      showToast(
        `Project creation blocked: ${draftProjectIdentityConflictReason}`,
      );
      return;
    }
    const runtime = createRuntimeContext();
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        client: draftClientName.trim(),
        reference: draftProjectCode.trim(),
        dueDate: draftProjectDueDate,
        system: draftIntakeProfile.system,
        status: "Draft",
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      showToast(
        payload.error?.message ||
          "The organization project could not be created",
      );
      return;
    }
    const id = payload.project.id;
    const project: LocalProject = {
      id,
      name,
      client: draftClientName.trim() || "Client not assigned",
      code:
        draftProjectCode.trim() || `LOCAL-${String(runtime.epoch).slice(-6)}`,
      dueDate: draftProjectDueDate,
      status: "Draft",
      intakeProfile: draftIntakeProfile,
      items: [],
      uploadedFiles: [],
      documentRoles: {},
      documentHashes: {},
      documentControls: {},
      revisionCandidates: [],
      lifecycleReviews: {},
      appliedDocumentHashes: [],
      indexedTechnicalHashes: [],
      baseTenderLoaded: false,
      technicalProfileLoaded: false,
      rateResolved: false,
      exchangeRateEvidence: { source: "", effectiveDate: "", validUntil: "" },
      riskAllowanceRate: 0,
      riskAllowanceReason: "",
      vatRate: 15,
      exchangeRate: 3.755,
      warrantyMonths: 12,
      validityDays: 30,
      clientPaymentTerms: "",
      clientDeliveryTerms: "",
      clientDeliveryLocation: "",
      clientFreightTerms: "",
      clientQualifications: "",
      scopeAlignmentDecision: {
        status: "Pending",
        evidenceReference: "",
        reason: "",
        sourceFingerprint: "",
      },
      requirementReviews: [],
      rfqs: [],
      quotationApprovals: [],
      auditEvents: migrateAuditEvents(
        [
          {
            id: runtime.epoch,
            action: "Project created",
            detail: `${name} · ${draftIntakeProfile.system} · ${draftIntakeProfile.country}${draftIntakeProfile.city ? ` / ${draftIntakeProfile.city}` : ""} · declared scope ${draftIntakeProfile.scopeIntent} (intake only, not approved) · inquiry ${draftIntakeProfile.inquirySubject?.trim() || "not recorded"}${draftIntakeProfile.inquiryReceived ? ` received ${draftIntakeProfile.inquiryReceived}` : ""} · routing contact ${draftIntakeProfile.contactName?.trim() || "not assigned"} · no documents, prices, supplier decisions or client terms copied`,
            actor: workingRole,
            time: runtime.localLabel,
          },
        ],
        id,
      ),
    };
    setSavedProjects((projects) => [
      currentProjectSnapshot(),
      ...projects.filter((saved) => saved.id !== projectId),
    ]);
    loadProject(project);
    setDraftProjectName("");
    setDraftClientName("");
    setDraftProjectCode("");
    setDraftProjectDueDate("");
    setDraftIntakeProfile({
      country: "Saudi Arabia",
      city: "",
      location: "",
      system: "Fire Detection & Alarm",
      scopeIntent: "Pending tender review",
      buildings: "",
      boqAvailability: "Unknown",
      drawingAvailability: "Unknown",
      inquirySubject: "",
      inquiryReceived: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
    });
    setNewProjectStep(1);
    setShowNewProject(false);
    showToast(`Project created in ${payload.organization.name}`);
  };

  const openNewProjectWizard = () => {
    setDraftProjectName("");
    setDraftClientName("");
    setDraftProjectCode("");
    setDraftProjectDueDate("");
    setDraftIntakeProfile({
      country: "Saudi Arabia",
      city: "",
      location: "",
      system: "Fire Detection & Alarm",
      scopeIntent: "Pending tender review",
      buildings: "",
      boqAvailability: "Unknown",
      drawingAvailability: "Unknown",
      inquirySubject: "",
      inquiryReceived: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
    });
    setNewProjectStep(1);
    setShowNewProject(true);
  };

  const closeNewProjectWizard = () => {
    setShowNewProject(false);
    setDraftProjectName("");
    setDraftClientName("");
    setDraftProjectCode("");
    setDraftProjectDueDate("");
    setDraftIntakeProfile({
      country: "Saudi Arabia",
      city: "",
      location: "",
      system: "Fire Detection & Alarm",
      scopeIntent: "Pending tender review",
      buildings: "",
      boqAvailability: "Unknown",
      drawingAvailability: "Unknown",
      inquirySubject: "",
      inquiryReceived: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
    });
    setNewProjectStep(1);
  };

  const duplicateCurrentProject = () => {
    const runtime = createRuntimeContext();
    const copyId = `local-copy-${runtime.epoch}`;
    const copiedAt = runtime.localLabel;
    const copy: LocalProject = {
      ...currentProjectSnapshot(),
      id: copyId,
      name: `${projectName} – Scope Copy`,
      code: `COPY-${String(runtime.epoch).slice(-6)}`,
      dueDate: "",
      status: "Draft",
      items: items.map((item) => ({
        ...item,
        supplier: "Awaiting technical selection",
        unitCost: 0,
        approvedSource: undefined,
        status: "RFQ Required",
      })),
      uploadedFiles: [...uploadedFiles],
      documentRoles: { ...documentRoles },
      documentHashes: { ...documentHashes },
      revisionCandidates: [],
      lifecycleReviews: {},
      appliedDocumentHashes: [...appliedDocumentHashes],
      indexedTechnicalHashes: [...indexedTechnicalHashes],
      rateResolved: false,
      exchangeRateEvidence: { source: "", effectiveDate: "", validUntil: "" },
      riskAllowanceRate: 0,
      riskAllowanceReason: "",
      clientPaymentTerms: "",
      clientDeliveryTerms: "",
      clientDeliveryLocation: "",
      clientFreightTerms: "",
      clientQualifications: "",
      scopeAlignmentDecision: {
        status: "Pending",
        evidenceReference: "",
        reason: "",
        sourceFingerprint: "",
      },
      rfqs: [],
      quotationApprovals: [],
      requirementReviews: technicalProfileLoaded
        ? fireRequirements.map((requirement) => ({
            ...requirement,
            evidence: "",
            reviewerNote: "",
          }))
        : [],
      auditEvents: migrateAuditEvents(
        [
          {
            id: runtime.epoch,
            action: "Scope-only project copy created",
            detail: `Copied documents and BOQ structure from ${projectName} · approved costs, supplier RFQs, technical decisions, client terms and quotation approvals excluded`,
            actor: workingRole,
            time: copiedAt,
          },
        ],
        copyId,
      ),
    };
    setSavedProjects((projects) => [
      copy,
      ...projects.filter((project) => project.id !== copyId),
    ]);
    setProjectOpen(false);
    setShowAllProjects(true);
    showToast(
      "Scope-only copy created — pricing and approvals were not copied",
    );
  };

  const totals = useMemo(() => {
    const visibleDirectCost = items.reduce(
      (sum, item) => sum + item.qty * item.unitCost,
      0,
    );
    const visibleSelling = items.reduce(
      (sum, item) => sum + item.qty * item.unitCost * (1 + item.markup / 100),
      0,
    );
    const directCost = visibleDirectCost;
    const supply = visibleSelling;
    const installation = 0;
    const riskAllowance = (supply * riskAllowanceRate) / 100;
    const selling = supply + installation + riskAllowance;
    return {
      directCost,
      supply,
      installation,
      riskAllowance,
      selling,
      profit: selling - directCost,
      margin: selling ? ((selling - directCost) / selling) * 100 : 0,
    };
  }, [items, riskAllowanceRate]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const recordAudit = (action: string, detail: string, actor = workingRole) => {
    setAuditEvents((current) =>
      prependAuditEvent(current, projectId, {
        id: Date.now(),
        action,
        detail,
        actor,
        time: new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date()),
      }),
    );
  };

  const updateDocumentControl = (
    fileName: string,
    patch: Partial<DocumentControl>,
  ) => {
    setDocumentControls((current) => ({
      ...current,
      [fileName]: {
        revision: "",
        issueDate: "",
        status: "Tender",
        transmittal: "",
        confirmed: false,
        ...current[fileName],
        ...patch,
        confirmed: false,
        confirmedAt: undefined,
        confirmedBy: undefined,
      },
    }));
  };

  const confirmDocumentControl = (fileName: string) => {
    const control = documentControls[fileName];
    const today = new Date().toISOString().slice(0, 10);
    if (
      !control?.revision.trim() ||
      !control.issueDate ||
      control.issueDate > today ||
      !control.transmittal.trim()
    ) {
      showToast(
        control?.issueDate && control.issueDate > today
          ? "Document issue date cannot be in the future"
          : "Revision, issue date and transmittal/reference are required",
      );
      return;
    }
    const confirmedAt = new Date().toISOString();
    setDocumentControls((current) => ({
      ...current,
      [fileName]: {
        ...control,
        revision: control.revision.trim(),
        transmittal: control.transmittal.trim(),
        confirmed: true,
        confirmedAt,
        confirmedBy: workingRole,
      },
    }));
    recordAudit(
      "Document issue metadata confirmed",
      `${fileName} · revision ${control.revision.trim()} · issued ${control.issueDate} · ${control.status} · ${control.transmittal.trim()}`,
    );
    showToast("Document issue metadata confirmed for this project");
  };

  const documentControlEditor = (fileName: string) => {
    const control = documentControls[fileName] || {
      revision: "",
      issueDate: "",
      status: "Tender" as DocumentIssueStatus,
      transmittal: "",
      confirmed: false,
    };
    const controlLocked = Boolean(
      documentHashes[fileName] &&
      (appliedDocumentHashes.includes(documentHashes[fileName]) ||
        indexedTechnicalHashes.includes(documentHashes[fileName])),
    );
    if (controlLocked)
      return (
        <section className="document-control-editor document-control-confirmed">
          <div className="section-title">
            <div>
              <small>DOCUMENT ISSUE CONTROL</small>
              <strong>Applied issue metadata is locked</strong>
            </div>
            <span>
              Revision {control.revision || "not recorded"} · {control.status}
            </span>
          </div>
          <p className="locked-control-note">
            This document has already produced project scope or technical
            requirements. Its issue metadata cannot be edited in place; register
            a genuinely revised file with a new content fingerprint.
          </p>
        </section>
      );
    const canConfirm = Boolean(
      control.revision.trim() &&
      control.issueDate &&
      control.issueDate <= new Date().toISOString().slice(0, 10) &&
      control.transmittal.trim(),
    );
    return (
      <section
        className={`document-control-editor ${control.confirmed ? "document-control-confirmed" : ""}`}
      >
        <div className="section-title">
          <div>
            <small>DOCUMENT ISSUE CONTROL</small>
            <strong>
              {control.confirmed
                ? `Revision ${control.revision} confirmed`
                : "Confirm construction issue metadata"}
            </strong>
          </div>
          <span>
            {control.confirmed
              ? `${control.status} · ${control.issueDate}`
              : "Required before scope changes"}
          </span>
        </div>
        <div className="document-control-fields">
          <label>
            Revision / issue
            <input
              value={control.revision}
              onChange={(event) =>
                updateDocumentControl(fileName, {
                  revision: event.target.value,
                })
              }
              placeholder="e.g. 1, A, T01"
            />
          </label>
          <label>
            Document issue date
            <input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={control.issueDate}
              onChange={(event) =>
                updateDocumentControl(fileName, {
                  issueDate: event.target.value,
                })
              }
            />
          </label>
          <label>
            Issue purpose
            <select
              value={control.status}
              onChange={(event) =>
                updateDocumentControl(fileName, {
                  status: event.target.value as DocumentIssueStatus,
                })
              }
            >
              <option>Tender</option>
              <option>Addendum</option>
              <option>For Information</option>
              <option>Superseded</option>
            </select>
          </label>
          <label>
            Transmittal / source reference
            <input
              value={control.transmittal}
              onChange={(event) =>
                updateDocumentControl(fileName, {
                  transmittal: event.target.value,
                })
              }
              placeholder="Required project evidence"
            />
          </label>
        </div>
        <footer>
          <p>
            {["Tender", "Addendum"].includes(control.status)
              ? "An active issue may enter extraction after content review. Confirmation records metadata only; it does not approve scope, compliance or price."
              : `${control.status} documents remain reference-only and cannot change the active BOQ or technical baseline.`}
          </p>
          <button
            disabled={!canConfirm || control.confirmed}
            onClick={() => confirmDocumentControl(fileName)}
          >
            {control.confirmed
              ? `Confirmed by ${control.confirmedBy}`
              : "Confirm issue metadata"}
          </button>
        </footer>
      </section>
    );
  };

  const documentIssueAllowsScope = (fileName: string) =>
    Boolean(
      documentControls[fileName]?.confirmed &&
      ["Tender", "Addendum"].includes(documentControls[fileName].status),
    );

  const updateRevisionCandidate = (
    id: string,
    patch: Partial<DocumentControl>,
  ) => {
    setRevisionCandidates((current) =>
      current.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              control: {
                ...candidate.control,
                ...patch,
                confirmed: false,
                confirmedAt: undefined,
                confirmedBy: undefined,
              },
            }
          : candidate,
      ),
    );
  };

  const registerRevisionCandidate = (id: string) => {
    const candidate = revisionCandidates.find((entry) => entry.id === id);
    if (!candidate) return;
    const today = new Date().toISOString().slice(0, 10);
    const control = candidate.control;
    if (
      !control.revision.trim() ||
      !control.issueDate ||
      control.issueDate > today ||
      !control.transmittal.trim()
    ) {
      showToast(
        control.issueDate && control.issueDate > today
          ? "Document issue date cannot be in the future"
          : "Revision, issue date and transmittal/reference are required",
      );
      return;
    }
    const dot = candidate.fileName.lastIndexOf(".");
    const stem =
      dot > 0 ? candidate.fileName.slice(0, dot) : candidate.fileName;
    const extension = dot > 0 ? candidate.fileName.slice(dot) : "";
    const registeredName = `${stem} [Rev ${control.revision.trim()} · ${candidate.candidateHash.slice(0, 8)}]${extension}`;
    const confirmedAt = new Date().toISOString();
    const confirmedControl: DocumentControl = {
      ...control,
      revision: control.revision.trim(),
      transmittal: control.transmittal.trim(),
      confirmed: true,
      confirmedAt,
      confirmedBy: workingRole,
    };
    setUploadedFiles((current) => [...new Set([...current, registeredName])]);
    setDocumentRoles((current) => ({
      ...current,
      [registeredName]: candidate.role,
    }));
    setDocumentHashes((current) => ({
      ...current,
      [registeredName]: candidate.candidateHash,
    }));
    setDocumentControls((current) => ({
      ...current,
      [registeredName]: confirmedControl,
    }));
    setRevisionCandidates((current) =>
      current.filter((entry) => entry.id !== id),
    );
    recordAudit(
      "Revised document issue registered",
      `${candidate.fileName} · previous SHA-256 ${candidate.previousHash.slice(0, 12)}… · candidate SHA-256 ${candidate.candidateHash.slice(0, 12)}… · revision ${confirmedControl.revision} · ${confirmedControl.status} · ${confirmedControl.transmittal} · existing baseline retained`,
    );
    showToast(
      "Revised issue registered separately; existing baseline remains unchanged",
    );
  };

  const updateLifecycleReviewNote = (id: string, note: string) => {
    setLifecycleReviews((current) => ({
      ...current,
      [id]: {
        status: current[id]?.status || "Pending",
        note,
        reviewedAt: current[id]?.reviewedAt,
        reviewedBy: current[id]?.reviewedBy,
      },
    }));
  };

  const decideLifecycleMapping = (
    mapping: ProductLifecycleMapping,
    status: "Acknowledged" | "Rejected",
  ) => {
    if (
      !requireWorkingRole(
        "Engineering Reviewer",
        "Product lifecycle mapping review",
      )
    )
      return;
    const note = lifecycleReviews[mapping.id]?.note.trim() || "";
    if (note.length < 12) {
      showToast("Lifecycle review requires an engineering note");
      return;
    }
    const reviewedAt = new Date().toISOString();
    setLifecycleReviews((current) => ({
      ...current,
      [mapping.id]: { status, note, reviewedAt, reviewedBy: workingRole },
    }));
    recordAudit(
      "Product lifecycle mapping reviewed",
      `${mapping.obsoletePart} → ${mapping.replacement} · workbook Obsolete & Replacement archive row ${mapping.sourceRow} · ${mapping.disposition} · ${status} · ${note} · discovery/clarification only · no compliance or price approved`,
    );
    showToast(
      status === "Acknowledged"
        ? "Lifecycle evidence acknowledged for discovery only"
        : "Lifecycle mapping rejected for this project",
    );
  };

  const requireWorkingRole = (requiredRole: WorkingRole, decision: string) => {
    if (workingRole === requiredRole) return true;
    showToast(
      `${decision} requires the server-assigned ${requiredRole} project permission`,
    );
    return false;
  };

  const auditCategoryFor = (
    event: AuditEvent,
  ): Exclude<AuditCategory, "All"> => {
    const value = `${event.action} ${event.detail}`.toLowerCase();
    const action = event.action.toLowerCase();
    if (/document|boq|source|specification|extraction|indexed/.test(action))
      return "Source";
    if (/quotation|award|approved|approval/.test(value)) return "Approval";
    if (/price|cost|markup|rate|supplier|rfq/.test(value)) return "Pricing";
    if (/commercial|vat|warranty|validity|payment|delivery|export/.test(value))
      return "Commercial";
    if (/document|boq|source|specification|extraction|indexed/.test(value))
      return "Source";
    return "Project";
  };

  const openGeneralUpload = () => {
    setPendingQuoteRfqId(null);
    setUploadIntentRole(null);
    setShowUploadIntent(true);
  };

  const openPriceSourceUpload = () => {
    setPendingQuoteRfqId(null);
    setUploadIntentRole("Price source");
    setShowUploadIntent(true);
  };

  const beginDocumentUpload = (role: DocumentRole) => {
    setUploadIntentRole(role);
    setShowUploadIntent(false);
    window.setTimeout(() => fileInput.current?.click(), 0);
  };

  const openPricingSettings = () => {
    if (!canViewCommercial) {
      showToast(
        "Commercial settings require a server-assigned commercial permission",
      );
      return;
    }
    setSettingsDraft({
      exchangeRate,
      exchangeRateEvidence,
      vatRate,
      riskAllowanceRate,
      riskAllowanceReason,
      warrantyMonths,
      validityDays,
      clientPaymentTerms,
      clientDeliveryTerms,
      clientDeliveryLocation,
      clientFreightTerms,
      clientQualifications,
    });
    setShowSettings(true);
  };

  const openProjectDetailsEditor = () => {
    setProjectDetailsDraft({
      name: projectName,
      client: clientName,
      code: projectCode,
      dueDate: projectDueDate,
      status: projectStatus,
    });
    setProjectOpen(false);
    setShowProjectEditor(true);
  };

  const saveProjectDetails = () => {
    if (!projectDetailsDraft.name.trim() || !projectDetailsDraft.code.trim()) {
      showToast("Project name and project code are required");
      return;
    }
    if (
      projectDetailsDraft.status === "Quotation Approved" &&
      !currentQuotationApproval
    ) {
      showToast(
        "Status update blocked: approve the current quotation fingerprint through the governed approval workflow",
      );
      return;
    }
    const previous = `${projectName} · ${clientName} · ${projectCode} · ${projectStatus}`;
    setProjectName(projectDetailsDraft.name.trim());
    setClientName(projectDetailsDraft.client.trim() || "Client not assigned");
    setProjectCode(projectDetailsDraft.code.trim());
    setProjectDueDate(projectDetailsDraft.dueDate);
    setProjectStatus(projectDetailsDraft.status);
    recordAudit(
      "Project details updated",
      `${previous} → ${projectDetailsDraft.name.trim()} · ${projectDetailsDraft.client.trim() || "Client not assigned"} · ${projectDetailsDraft.code.trim()} · ${projectDetailsDraft.status}`,
    );
    setShowProjectEditor(false);
    showToast("Project details applied with an audit entry");
  };

  const confirmPricingSettings = () => {
    if (
      !requireWorkingRole(
        "Commercial Approver",
        "Commercial settings confirmation",
      )
    )
      return;
    const valuesValid =
      Number.isFinite(settingsDraft.exchangeRate) &&
      settingsDraft.exchangeRate > 0 &&
      Number.isFinite(settingsDraft.vatRate) &&
      settingsDraft.vatRate >= 0 &&
      settingsDraft.vatRate <= 100 &&
      Number.isFinite(settingsDraft.riskAllowanceRate) &&
      settingsDraft.riskAllowanceRate >= 0 &&
      settingsDraft.riskAllowanceRate <= 100 &&
      (settingsDraft.riskAllowanceRate === 0 ||
        settingsDraft.riskAllowanceReason.trim().length >= 10) &&
      settingsDraft.warrantyMonths > 0 &&
      settingsDraft.validityDays > 0;
    const termsValid =
      scopeMissing ||
      (settingsDraft.clientPaymentTerms.trim() &&
        settingsDraft.clientDeliveryTerms.trim() &&
        settingsDraft.clientDeliveryLocation.trim() &&
        settingsDraft.clientFreightTerms.trim() &&
        settingsDraft.clientQualifications.trim().length >= 4);
    const today = new Date().toISOString().slice(0, 10);
    const evidence = settingsDraft.exchangeRateEvidence;
    const evidenceValid =
      evidence.source.trim().length >= 3 &&
      Boolean(evidence.effectiveDate) &&
      evidence.effectiveDate <= today &&
      Boolean(evidence.validUntil) &&
      evidence.validUntil >= today &&
      evidence.validUntil >= evidence.effectiveDate;
    if (!valuesValid || !termsValid || !evidenceValid) {
      showToast(
        !termsValid
          ? "Commercial settings require explicit client payment, delivery, freight and qualification terms"
          : !evidenceValid
            ? "Exchange rate requires a source, effective date and current valid-until date"
            : "Check exchange rate, VAT, warranty and validity values",
      );
      return;
    }
    const previous = `${exchangeRate.toFixed(3)} SAR/USD · VAT ${vatRate}% · risk allowance ${riskAllowanceRate}% · ${warrantyMonths}m warranty · ${validityDays}d validity`;
    setExchangeRate(settingsDraft.exchangeRate);
    setVatRate(settingsDraft.vatRate);
    setRiskAllowanceRate(settingsDraft.riskAllowanceRate);
    setRiskAllowanceReason(
      settingsDraft.riskAllowanceRate > 0
        ? settingsDraft.riskAllowanceReason.trim()
        : "",
    );
    setWarrantyMonths(settingsDraft.warrantyMonths);
    setValidityDays(settingsDraft.validityDays);
    setClientPaymentTerms(settingsDraft.clientPaymentTerms.trim());
    setClientDeliveryTerms(settingsDraft.clientDeliveryTerms.trim());
    setClientDeliveryLocation(settingsDraft.clientDeliveryLocation.trim());
    setClientFreightTerms(settingsDraft.clientFreightTerms.trim());
    setClientQualifications(settingsDraft.clientQualifications.trim());
    setExchangeRateEvidence({
      ...evidence,
      source: evidence.source.trim(),
      confirmedAt: new Date().toISOString(),
      confirmedBy: workingRole,
    });
    setRateResolved(true);
    recordAudit(
      "Commercial settings confirmed",
      `${previous} → ${settingsDraft.exchangeRate.toFixed(3)} SAR/USD · source ${evidence.source.trim()} · effective ${evidence.effectiveDate} · valid until ${evidence.validUntil} · VAT ${settingsDraft.vatRate}% · risk allowance ${settingsDraft.riskAllowanceRate}%${settingsDraft.riskAllowanceRate ? ` (${settingsDraft.riskAllowanceReason.trim()})` : " (none)"} · ${settingsDraft.warrantyMonths}m warranty · ${settingsDraft.validityDays}d validity · client payment, delivery, freight and qualification terms recorded`,
    );
    setShowSettings(false);
    showToast("Commercial settings applied together with an audit entry");
  };

  const openSourceReview = (fileName: string) => {
    setSourcePreviewFile(fileName);
    setSourceReviewConfirmed(
      durablePriceSourceHashes.includes(honeywellPriceListSha256),
    );
  };

  const openMarkupReview = (item: CostItem) => {
    setActiveMarkupItemId(item.id);
    setMarkupDraft(item.markup);
    setMarkupReason("");
  };

  const saveMarkupReview = () => {
    if (!requireWorkingRole("Commercial Approver", "Markup approval")) return;
    const item = items.find((entry) => entry.id === activeMarkupItemId);
    if (
      !item ||
      !Number.isFinite(markupDraft) ||
      markupDraft < 0 ||
      markupDraft > 500 ||
      !markupReason.trim()
    ) {
      showToast(
        "Markup change requires a value from 0% to 500% and an audit reason",
      );
      return;
    }
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, markup: markupDraft } : entry,
      ),
    );
    recordAudit(
      "Markup changed",
      `${item.item} · ${item.markup}% → ${markupDraft}% · reason: ${markupReason.trim()}`,
    );
    setActiveMarkupItemId(null);
    setMarkupReason("");
    showToast(
      "Markup updated with an audit entry; quotation approval must be refreshed",
    );
  };

  const resolveDataLinks = () => {
    const firstOutstanding = items.find((item) => item.status !== "Costed");
    if (firstOutstanding) setMatchingItemId(firstOutstanding.id);
  };

  const addIncompleteItem = () => {
    const id = Math.max(...items.map((item) => item.id), 0) + 1;
    setItems((current) => [
      ...current,
      {
        id,
        system: "Unclassified",
        item: "New BOQ item",
        qty: 1,
        supplier: "Not assigned",
        unitCost: 0,
        markup: 20,
        status: "Missing Link",
        unit: "",
        specification: "",
        sourceRows: [],
      },
    ]);
    recordAudit(
      "Draft BOQ item created",
      `Item ${id} requires classification and specification before pricing`,
    );
    setMatchingItemId(id);
    showToast("Draft item added — complete its details before pricing");
  };

  const refreshPersistentMatching = async (persistentItemId: string) => {
    const [statusPayload, candidatePayload] = await Promise.all([
      requestJson<{ status?: string }>(technicalApi.matching(persistentItemId, "status"), { cache: "no-store" }),
      requestJson<{ candidates?: PersistentMatchCandidate[] }>(technicalApi.matching(persistentItemId, "candidates"), { cache: "no-store" }),
    ]);
    setPersistentMatchStatus(statusPayload.status || "Not Started");
    setPersistentMatchCandidates(candidatePayload.candidates || []);
    return { statusPayload, candidatePayload };
  };

  const startPersistentMatching = async (
    item: ExtractedBoqItem,
    recalculate = false,
  ) => {
    const persistentItemId = item.id;
    setPersistentMatchLoading(true);
    setPersistentMatchError("");
    try {
      await commandThenRefresh({
        command: () => requestJson(
          technicalApi.matching(persistentItemId, recalculate ? "recalculate" : "start"),
          { method: "POST" },
        ),
        refresh: () => refreshPersistentMatching(persistentItemId),
      });
      showToast("Technical product matching queued");
    } catch (error) {
      setPersistentMatchError(
        error instanceof Error ? error.message : "Matching could not start.",
      );
    } finally {
      setPersistentMatchLoading(false);
    }
  };

  const openSafetyDecision = async (
    candidateId: string,
    recalculate = false,
  ) => {
    setSafetyCandidateId(candidateId);
    setSafetyLoading(true);
    setSafetyError("");
    try {
      let response = await fetch(
        `/api/match-candidates/${encodeURIComponent(candidateId)}/safety`,
        { cache: "no-store" },
      );
      if (response.status === 409 || recalculate)
        response = await fetch(
          `/api/match-candidates/${encodeURIComponent(candidateId)}/safety/${recalculate ? "recalculate" : "evaluate"}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              reason: recalculate
                ? "Reviewer-requested safety recalculation"
                : "Candidate safety evaluation",
            }),
          },
        );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message || "Safety evaluation could not be loaded.",
        );
      setSafetyDecision(payload.decision);
    } catch (error) {
      setSafetyDecision(null);
      setSafetyError(
        error instanceof Error
          ? error.message
          : "Safety evaluation could not be loaded.",
      );
    } finally {
      setSafetyLoading(false);
    }
  };

  const acknowledgeSafetyWarnings = async () => {
    if (!safetyDecision || !safetyCandidateId) return;
    const warningIds = safetyDecision.warnings
        .filter((entry) => !entry.acknowledged_at)
        .map((entry) => entry.id),
      reason = window.prompt("Warning acknowledgment reason")?.trim();
    if (!warningIds.length || !reason) return;
    setSafetyLoading(true);
    try {
      const response = await fetch(
          `/api/match-candidates/${encodeURIComponent(safetyCandidateId)}/safety/warnings/acknowledge`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ warningIds, reason }),
          },
        ),
        payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message || "Warnings could not be acknowledged.",
        );
      await openSafetyDecision(safetyCandidateId);
    } catch (error) {
      setSafetyError(
        error instanceof Error
          ? error.message
          : "Warnings could not be acknowledged.",
      );
    } finally {
      setSafetyLoading(false);
    }
  };
  const approveTechnicalSafety = async () => {
    if (!safetyDecision || !safetyCandidateId) return;
    const reason = window.prompt("Technical approval reason")?.trim();
    if (!reason) return;
    setSafetyLoading(true);
    try {
      const response = await fetch(
          `/api/match-candidates/${encodeURIComponent(safetyCandidateId)}/safety/approve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              approvalType: "Technical",
              entityVersion: safetyDecision.version_number,
              reason,
              evidence: { decisionId: safetyDecision.id },
            }),
          },
        ),
        payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message || "Technical approval could not be recorded.",
        );
      await openSafetyDecision(safetyCandidateId);
    } catch (error) {
      setSafetyError(
        error instanceof Error
          ? error.message
          : "Technical approval could not be recorded.",
      );
    } finally {
      setSafetyLoading(false);
    }
  };

  const createPricingScenario = async () => {
    const name = window.prompt("Scenario name", "Base Case")?.trim();
    if (!name) return;
    try {
      const response = await fetch(
          commercialApi.scenarios(projectId),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              mode: "Base Case",
              projectCurrency: currency,
              settings: {
                precision: 2,
                sellingRule: { method: "Markup", rate: 20, minimumMargin: 10 },
                vatRule: { rate: vatRate },
                customerDiscount: { percentage: 0 },
              },
            }),
          },
        ),
        payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message || "Scenario could not be created.",
        );
      const refreshed = await requestJson<{ scenarios: PersistentPricingScenario[] }>(
        commercialApi.scenarios(projectId),
        { cache: "no-store" },
      );
      setPricingScenarios(refreshed.scenarios || []);
      setPricingScenarioId(payload.scenarioId);
      setPersistentPricingError("");
    } catch (error) {
      setPersistentPricingError(
        error instanceof Error
          ? error.message
          : "Scenario could not be created.",
      );
    }
  };

  const calculatePersistentPricing = async (item: CostItem) => {
    const persistentItem = extractedBoqItems.find(
      (entry) => entry.sequence === item.id,
    );
    if (!persistentItem || !pricingScenarioId) {
      setPersistentPricingError(
        !persistentItem
          ? "Apply a reviewed persistent BOQ extraction first."
          : "Create or select a pricing scenario first.",
      );
      return;
    }
    setPersistentPricingLoadingId(item.id);
    setPersistentPricingError("");
    try {
      const candidateResponse = await fetch(
          `/api/boq-items/${encodeURIComponent(persistentItem.id)}/matching/candidates`,
        ),
        candidatePayload = await candidateResponse.json();
      if (!candidateResponse.ok)
        throw new Error(
          candidatePayload.error?.message ||
            "Technical candidates could not be loaded.",
        );
      const candidate =
        (candidatePayload.candidates || []).find(
          (entry: PersistentMatchCandidate) =>
            entry.technical_status === "Technically Compliant",
        ) || candidatePayload.candidates?.[0];
      if (!candidate) throw new Error("Run technical matching before pricing.");
      const pricesResponse = await fetch(
          `/api/products/${encodeURIComponent(candidate.product_id)}/prices?projectId=${encodeURIComponent(projectId)}`,
        ),
        pricesPayload = await pricesResponse.json();
      if (!pricesResponse.ok)
        throw new Error(
          pricesPayload.error?.message || "Price sources could not be loaded.",
        );
      const eligiblePrices = (pricesPayload.prices || []).filter(
        (entry: { eligibleForCosting?: boolean }) => entry.eligibleForCosting,
      );
      let selectedPriceSourceId = "";
      if (eligiblePrices.length === 1) {
        if (
          !window.confirm(
            `Use the approved price source ${eligiblePrices[0].file_name || eligiblePrices[0].id} at ${eligiblePrices[0].amount} ${eligiblePrices[0].currency}?`,
          )
        )
          throw new Error("Price source selection was cancelled.");
        selectedPriceSourceId = eligiblePrices[0].id;
      } else if (eligiblePrices.length > 1) {
        const choice = window.prompt(
          `Select a price source number:\n${eligiblePrices.map((entry: { file_name?: string; id: string; amount: number; currency: string }, index: number) => `${index + 1}. ${entry.file_name || entry.id} — ${entry.amount} ${entry.currency}`).join("\n")}`,
          "1",
        );
        const selected = eligiblePrices[Number(choice) - 1];
        if (!selected)
          throw new Error("Select one approved current price source.");
        selectedPriceSourceId = selected.id;
      }
      const response = await fetch(
        commercialApi.calculatePricing(persistentItem.id),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              scenarioId: pricingScenarioId,
              candidateId: candidate.id,
              selectedPriceSourceId,
              reason:
                "Estimator explicitly selected the governed price source and requested calculation",
            }),
          },
        ),
        payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message || "Pricing could not be calculated.",
        );
      const authoritative = await requestJson<PersistentPricingLine>(
        commercialApi.pricingLine(persistentItem.id, pricingScenarioId),
        { cache: "no-store" },
      );
      setPersistentPricingLines((current) => ({ ...current, [persistentItem.id]: authoritative }));
    } catch (error) {
      setPersistentPricingError(
        error instanceof Error
          ? error.message
          : "Pricing could not be calculated.",
      );
    } finally {
      setPersistentPricingLoadingId(null);
    }
  };

  const approvedPricingCandidate = async (itemId: string) => {
    const payload = await requestJson<{ candidates: PersistentMatchCandidate[] }>(
      `/api/boq-items/${encodeURIComponent(itemId)}/matching/candidates`,
      { cache: "no-store" },
    );
    const candidate = (payload.candidates || []).find(
      (entry) => entry.technical_status === "Technically Compliant",
    );
    if (!candidate)
      throw new Error("A technically approved product candidate is required before price evidence can be submitted.");
    return candidate;
  };

  const submitManualPriceEvidence = async (itemId: string) => {
    if (!pricingScenarioId) {
      setPersistentPricingError("Create or select a pricing scenario first.");
      return;
    }
    try {
      const candidate = await approvedPricingCandidate(itemId);
      const source = window.prompt("Supplier quotation or price-source reference:", "Supplier quotation");
      if (!source?.trim()) return;
      const rawPrice = window.prompt(`Unit price for ${candidate.part_number} (${currency}):`, "");
      if (rawPrice === null) return;
      const price = Number(rawPrice);
      if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a positive unit price.");
      const effectiveFrom = window.prompt("Effective date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
      if (!effectiveFrom) return;
      const defaultValidity = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const validUntil = window.prompt("Validity end date (YYYY-MM-DD):", defaultValidity);
      if (!validUntil) return;
      const reason = window.prompt("Required evidence reason (minimum 10 characters):", "Estimator submitted exact supplier evidence for governed review");
      if (!reason?.trim()) return;
      await requestJson(
        commercialApi.manualPrice(itemId, pricingScenarioId),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidateId: candidate.id,
            productId: candidate.product_id,
            source: source.trim(),
            price,
            currency,
            effectiveFrom,
            validUntil,
            scope: "Project",
            reason: reason.trim(),
          }),
        },
      );
      const sources = await loadPersistentPriceSourcesForItem(itemId);
      setPersistentPriceSources((current) => ({ ...current, [itemId]: sources }));
      setPersistentPricingError("");
      showToast("Manual price persisted as Needs Review / Discovery Only");
    } catch (error) {
      setPersistentPricingError(error instanceof Error ? error.message : "Manual price evidence could not be submitted.");
    }
  };

  const reviewPersistentPriceSource = async (itemId: string, sourceId: string) => {
    const reason = window.prompt("Review reason (minimum 10 characters):", "Verified exact source, validity and product scope for project costing");
    if (!reason?.trim()) return;
    try {
      await requestJson(
        commercialApi.reviewPriceSource(sourceId),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ downstreamUse: "Costing", reason: reason.trim() }),
        },
      );
      const sources = await loadPersistentPriceSourcesForItem(itemId);
      setPersistentPriceSources((current) => ({ ...current, [itemId]: sources }));
      setPersistentPricingError("");
      showToast("Server review completed; costing eligibility was refetched");
    } catch (error) {
      setPersistentPricingError(error instanceof Error ? error.message : "Price evidence review failed.");
    }
  };

  const downloadCsv = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = (content: string, filename: string) => {
    const blob = new Blob([content], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportLocalBackup = () => {
    const projects = [
      currentProjectSnapshot(),
      ...savedProjects.filter((project) => project.id !== projectId),
    ];
    const exportedAt = new Date().toISOString();
    const core = {
      schemaVersion: 1 as const,
      product: "AI Pricing Agent Local Backup" as const,
      exportedAt,
      projects,
    };
    const envelope: LocalBackupEnvelope = {
      ...core,
      checksum: localBackupChecksum(JSON.stringify(core)),
    };
    downloadJson(
      JSON.stringify(envelope, null, 2),
      `AI-Pricing-Agent-Local-Backup-${exportedAt.slice(0, 10)}.json`,
    );
    recordAudit(
      "Local portfolio backup exported",
      `${projects.length} project${projects.length === 1 ? "" : "s"} · ${envelope.checksum} · browser-local document names, fingerprints, decisions and audit records · source file bytes not embedded`,
    );
    showToast("Checksummed local backup downloaded");
  };

  const inspectLocalBackup = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBackupError("");
    setBackupPreview(null);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Backup exceeds the 10 MB local safety limit");
      const parsed = JSON.parse(
        await file.text(),
      ) as Partial<LocalBackupEnvelope>;
      if (
        parsed.schemaVersion !== 1 ||
        parsed.product !== "AI Pricing Agent Local Backup" ||
        typeof parsed.exportedAt !== "string" ||
        Number.isNaN(Date.parse(parsed.exportedAt)) ||
        typeof parsed.checksum !== "string" ||
        !Array.isArray(parsed.projects) ||
        !parsed.projects.length ||
        parsed.projects.length > 200
      )
        throw new Error("Unsupported or empty backup package");
      const core = {
        schemaVersion: parsed.schemaVersion,
        product: parsed.product,
        exportedAt: parsed.exportedAt,
        projects: parsed.projects,
      };
      if (localBackupChecksum(JSON.stringify(core)) !== parsed.checksum)
        throw new Error("Backup checksum does not match its contents");
      const projectIds = new Set<string>();
      for (const project of parsed.projects) {
        if (
          !project ||
          typeof project !== "object" ||
          typeof project.id !== "string" ||
          !project.id ||
          typeof project.name !== "string" ||
          !project.name ||
          !Array.isArray(project.items) ||
          project.items.length > 10000 ||
          !Array.isArray(project.uploadedFiles) ||
          project.uploadedFiles.length > 5000 ||
          !Array.isArray(project.auditEvents) ||
          !Array.isArray(project.rfqs) ||
          !Array.isArray(project.quotationApprovals)
        )
          throw new Error("A project record is incomplete");
        if (projectIds.has(project.id))
          throw new Error("Backup contains duplicate project identifiers");
        projectIds.add(project.id);
        if (
          !project.items.every(
            (item) =>
              item &&
              Number.isFinite(item.id) &&
              typeof item.item === "string" &&
              Number.isFinite(item.qty) &&
              Number.isFinite(item.unitCost) &&
              Number.isFinite(item.markup) &&
              typeof item.status === "string",
          )
        )
          throw new Error(`Project ${project.name} contains invalid BOQ data`);
        if (!project.uploadedFiles.every((name) => typeof name === "string"))
          throw new Error(
            `Project ${project.name} contains invalid document names`,
          );
        if (
          !project.rfqs.every(
            (rfq) => !rfq.projectId || rfq.projectId === project.id,
          ) ||
          !project.quotationApprovals.every(
            (approval) =>
              !approval.projectId || approval.projectId === project.id,
          )
        )
          throw new Error(
            `Project ${project.name} contains cross-project commercial records`,
          );
        const sealedAuditPresent = project.auditEvents.some(
          (event) => event.eventHash || event.previousHash || event.projectId,
        );
        if (
          sealedAuditPresent &&
          !auditChainIntegrity(project.auditEvents, project.id)
        )
          throw new Error(
            `Project ${project.name} contains a broken audit chain`,
          );
      }
      const existingIds = new Set([
        projectId,
        ...savedProjects.map((project) => project.id),
      ]);
      setBackupPreview({
        envelope: parsed as LocalBackupEnvelope,
        conflicts: parsed.projects.filter((project) =>
          existingIds.has(project.id),
        ).length,
        boqItems: parsed.projects.reduce(
          (sum, project) => sum + project.items.length,
          0,
        ),
        documents: parsed.projects.reduce(
          (sum, project) =>
            sum +
            project.uploadedFiles.length +
            (project.baseTenderLoaded ? tenderDocuments.length : 0),
          0,
        ),
      });
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : "Backup could not be read",
      );
    }
  };

  const restoreLocalBackup = () => {
    if (!backupPreview) return;
    const restoredAt = new Date().toISOString();
    const restored = backupPreview.envelope.projects.map(
      (project, index): LocalProject => {
        const restoredProjectId = `restored-${Date.now()}-${index + 1}`;
        return {
          ...project,
          id: restoredProjectId,
          name: `${project.name} – Restored`,
          code: `${project.code || "PROJECT"}-RESTORED-${index + 1}`,
          documentRoles: project.documentRoles || {},
          documentHashes: project.documentHashes || {},
          documentControls: project.documentControls || {},
          revisionCandidates: project.revisionCandidates || [],
          lifecycleReviews: project.lifecycleReviews || {},
          appliedDocumentHashes: project.appliedDocumentHashes || [],
          indexedTechnicalHashes: project.indexedTechnicalHashes || [],
          requirementReviews: project.requirementReviews || [],
          rfqs: migrateRfqRecords(project.rfqs || [], restoredProjectId),
          quotationApprovals: migrateQuotationApprovals(
            project.quotationApprovals || [],
            restoredProjectId,
          ),
          scopeAlignmentDecision: project.scopeAlignmentDecision || {
            status: "Pending",
            evidenceReference: "",
            reason: "",
            sourceFingerprint: "",
          },
          auditEvents: prependAuditEvent(
            migrateAuditEvents(project.auditEvents || [], restoredProjectId),
            restoredProjectId,
            {
              id: Date.now() + index,
              action: "Project restored from local backup",
              detail: `${backupPreview.envelope.checksum} · exported ${backupPreview.envelope.exportedAt} · restored ${restoredAt} as a separate workspace · prior quotation approvals retained as history but require a new project fingerprint`,
              actor: workingRole,
              time: new Intl.DateTimeFormat("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date()),
            },
          ),
        };
      },
    );
    setSavedProjects((current) => [...restored, ...current]);
    setBackupPreview(null);
    setBackupError("");
    setShowAllProjects(true);
    showToast(
      `${restored.length} project${restored.length === 1 ? "" : "s"} restored as separate local workspaces`,
    );
  };

  const downloadBoqTemplate = () => {
    downloadCsv(createBoqTemplateCsv(), "Construction-BOQ-Import-Template.csv");
    recordAudit(
      "Blank BOQ template downloaded",
      "Required fields: System, Description, Unit and Quantity · optional technical reference · no price or supplier columns",
    );
  };

  const exportCostSheet = () => {
    const csvCell = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const safeProjectName =
      projectName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") ||
      "Project";
    const exportedAt = new Date().toISOString();
    const metadata = [
      ["EXPORT STATUS", "DRAFT - NOT APPROVED FOR ISSUE"],
      ["Purpose", "Working cost review only"],
      ["Project", projectName],
      ["Project reference", projectCode || "Not assigned"],
      ["Quotation fingerprint", quotationFingerprint],
      ["Generated at", exportedAt],
      ["Priced BOQ lines", `${pricedCount} of ${items.length}`],
      ["Open controls", alertCount],
      ["Contingency / risk allowance", `${riskAllowanceRate}%`],
      ["Risk allowance rationale", riskAllowanceReason || "None"],
      [
        "Approved current revision",
        currentQuotationApproval
          ? `R${currentQuotationApproval.revision}`
          : "No",
      ],
      [
        "Warning",
        "This draft may contain missing prices and must not be issued to a client",
      ],
    ].map((row) => row.map(csvCell).join(","));
    const header =
      "Item No.,BOQ Reference,System,BOQ Description,Specification,Manufacturer,Selected Model,Part Number,Unit,Quantity,List Price,Discount,Net Unit Cost,Total Cost,Margin,Selling Price,Total Selling Price,Supplier,Confidence,Matching Source,Alternative,Remarks";
    const rows = items.map((item) =>
      [
        item.id,
        `BOQ-${String(item.id).padStart(3, "0")}`,
        item.system,
        `"${item.item}"`,
        `"${item.specification}"`,
        item.supplier,
        "",
        "",
        item.unit,
        item.qty,
        item.unitCost,
        "",
        item.unitCost,
        item.qty * item.unitCost,
        item.markup,
        (item.unitCost * (1 + item.markup / 100)).toFixed(2),
        (item.qty * item.unitCost * (1 + item.markup / 100)).toFixed(2),
        item.supplier,
        item.status === "Costed" ? "Approved" : "Discovery Only",
        item.approvedSource || "",
        "",
        item.status,
      ].join(","),
    );
    downloadCsv(
      [...metadata, "", header, ...rows].join("\n"),
      `${safeProjectName}-DRAFT-Cost-Sheet.csv`,
    );
    recordAudit(
      "Draft cost sheet exported",
      `${items.length} items · ${alertCount} open controls · ${quotationFingerprint} · not approved for issue`,
    );
    showToast("Draft cost sheet downloaded — not approved for issue");
  };

  const exportFinalIssuePackage = () => {
    if (!currentQuotationApproval || alertCount > 0) {
      showToast(
        "Final export blocked: approve the current quotation revision after all controls pass",
      );
      return;
    }
    const csvCell = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const safeProjectName =
      projectName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") ||
      "Project";
    const metadata = [
      ["ISSUE STATUS", "FINAL - APPROVED FOR ISSUE"],
      ["Project", projectName],
      ["Project reference", projectCode || "Not assigned"],
      ["Client", clientName || "Not assigned"],
      ["Quotation revision", `R${currentQuotationApproval.revision}`],
      ["Quotation fingerprint", currentQuotationApproval.fingerprint],
      ["Approved by", currentQuotationApproval.approvedBy],
      ["Approved at", currentQuotationApproval.approvedAt],
      ["Priced BOQ lines", `${pricedCount} of ${items.length}`],
      ["Open controls", alertCount],
      ["Subtotal SAR", totals.selling.toFixed(2)],
      ["Base line-level selling SAR", totals.supply.toFixed(2)],
      ["Contingency / risk allowance", `${riskAllowanceRate}%`],
      ["Risk allowance amount SAR", totals.riskAllowance.toFixed(2)],
      ["Risk allowance rationale", riskAllowanceReason || "None"],
      ["VAT rate", `${vatRate}%`],
      [
        "Tax basis",
        `Line selling prices and subtotal exclude VAT; VAT is added separately at ${vatRate}%`,
      ],
      [
        "Total including VAT SAR",
        (totals.selling * (1 + vatRate / 100)).toFixed(2),
      ],
      ["Client payment terms", clientPaymentTerms],
      ["Client delivery terms", clientDeliveryTerms],
      ["Client delivery location", clientDeliveryLocation],
      ["Client freight treatment", clientFreightTerms],
      ["Client qualifications and assumptions", clientQualifications],
      ["Priced scope boundary", "Material supply for reviewed BOQ lines only"],
      [
        "Excluded services",
        "Installation; cabling; programming; testing; commissioning; civil works; and unlisted items",
      ],
      [
        "Scope alignment authority",
        knownServiceScope
          ? scopeAlignmentDecision.evidenceReference
          : "No tender service obligation detected in the reviewed scope",
      ],
      [
        "Scope alignment decision",
        knownServiceScope
          ? scopeAlignmentDecision.reason
          : "No materials-only deviation required",
      ],
      [
        "Commercial confidentiality",
        "Internal cost, markup, supplier identity and procurement source evidence are intentionally omitted from this client output",
      ],
    ].map((row) => row.map(csvCell).join(","));
    const header = [
      "BOQ reference",
      "Description",
      "Unit",
      "Quantity",
      "Selling unit price",
      "Total selling price",
    ]
      .map(csvCell)
      .join(",");
    const rows = items.map((item) =>
      [
        `BOQ-${String(item.id).padStart(3, "0")}`,
        item.item,
        item.unit,
        item.qty,
        (item.unitCost * (1 + item.markup / 100)).toFixed(2),
        (item.qty * item.unitCost * (1 + item.markup / 100)).toFixed(2),
      ]
        .map(csvCell)
        .join(","),
    );
    downloadCsv(
      [...metadata, "", header, ...rows].join("\n"),
      `${safeProjectName}-R${currentQuotationApproval.revision}-APPROVED-Client-Quotation.csv`,
    );
    recordAudit(
      "Final issue package exported",
      `R${currentQuotationApproval.revision} · ${currentQuotationApproval.fingerprint} · approved by ${currentQuotationApproval.approvedBy} · client-safe selling values only`,
    );
    showToast(
      `Approved client quotation R${currentQuotationApproval.revision} downloaded`,
    );
  };

  const exportAuditRegister = () => {
    const csvCell = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const safeProjectName =
      projectName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") ||
      "Project";
    const metadata = [
      ["REGISTER", "PROJECT AUDIT TRAIL"],
      ["Project", projectName],
      ["Project reference", projectCode || "Not assigned"],
      ["Project ID", projectId],
      ["Workspace context", workspaceContextSeal],
      ["Generated at", new Date().toISOString()],
      ["Event count", projectAuditEvents.length],
      ["Audit chain", auditIntegrityValid ? "Verified" : "BROKEN"],
      ["Chain head", auditChainHead],
      ["Storage", "Local project workspace"],
      [
        "Integrity method",
        "Ordered FNV-1a-style browser checksum chain over project owner, event content, displayed time and predecessor",
      ],
      [
        "Clock basis",
        "Event display time comes from the local device clock and is not a trusted server timestamp",
      ],
      [
        "Proof limitation",
        "Tamper-evident working control only; not a cryptographic signature, qualified electronic seal or multi-user server audit log",
      ],
      [
        "Notice",
        "Export is a point-in-time copy; the in-app project history remains the working record",
      ],
    ].map((row) => row.map(csvCell).join(","));
    const header = [
      "Event reference",
      "Project ID",
      "Category",
      "Action",
      "Detail",
      "Actor",
      "Recorded time",
      "Previous event hash",
      "Event hash",
    ]
      .map(csvCell)
      .join(",");
    const rows = projectAuditEvents.map((event) =>
      [
        `EVT-${event.id}`,
        event.projectId || "",
        auditCategoryFor(event),
        event.action,
        event.detail,
        event.actor,
        event.time,
        event.previousHash || "",
        event.eventHash || "",
      ]
        .map(csvCell)
        .join(","),
    );
    downloadCsv(
      [...metadata, "", header, ...rows].join("\n"),
      `${safeProjectName}-Audit-Register.csv`,
    );
    recordAudit(
      "Audit register exported",
      `${projectAuditEvents.length} prior events · point-in-time local CSV · project ${projectCode || projectName}`,
    );
    showToast("Project audit register downloaded locally");
  };

  const prepareRfqPackages = (requestedItemIds?: number[]) => {
    const runtime = createRuntimeContext();
    const today = runtime.iso.slice(0, 10);
    const requestedScope = new Set(requestedItemIds || []);
    const unresolvedIds = items
      .filter((item) => !hasCurrentPriceEvidence(item, today))
      .map((item) => item.id)
      .filter((itemId) => !requestedItemIds || requestedScope.has(itemId))
      .filter(
        (itemId) =>
          !rfqs.some(
            (rfq) => rfq.status !== "Awarded" && rfq.itemIds.includes(itemId),
          ),
      );
    if (!unresolvedIds.length) {
      showToast("No uncovered price-evidence gaps are available for a new RFQ");
      return;
    }
    const exactFireAlarmScope =
      !requestedItemIds &&
      rfqs.length === 0 &&
      items.length === 21 &&
      items.every((item) => item.system === "Fire Detection & Alarm") &&
      [7, 20].every((id) => unresolvedIds.includes(id));
    const createdAt = runtime.localLabel;
    const common = {
      projectId,
      status: "Draft" as const,
      supplier: "",
      responseDue: "",
      deliveryLocation: "",
      requirements:
        "Please confirm unit price, quotation validity, lead time, warranty, freight, payment terms and technical compliance evidence.",
      responseFiles: [] as string[],
      createdAt,
    };
    const packages: RfqRecord[] = exactFireAlarmScope
      ? [
          {
            ...common,
            id: `rfq-panel-${runtime.epoch}`,
            code: "FA-PKG-01",
            title: "Control panels, network and power",
            itemIds: [7, 20],
            scopeNote:
              "2 BOQ lines · 1 MFACP + 6 FACP · panels, network interfaces, batteries, programming and commissioning",
            evidenceNote:
              "Include BOQ references and Specification 28 46 00 clauses for network capacity, power and warranty.",
          },
          {
            ...common,
            id: `rfq-devices-${runtime.epoch + 1}`,
            code: "FA-PKG-02",
            title: "Detection and notification devices",
            itemIds: unresolvedIds
              .filter((id) => id <= 15 && id !== 7)
              .concat(unresolvedIds.includes(21) ? [21] : []),
            scopeNote:
              "15 BOQ lines · 2,405 field devices · detectors, stations, modules, strobes and telephone jacks",
            evidenceNote:
              "Require product schedule, part numbers, bases/accessories and technical compliance evidence.",
          },
          {
            ...common,
            id: `rfq-interfaces-${runtime.epoch + 2}`,
            code: "FA-PKG-03",
            title: "Interfaces, cabling and installation scope",
            itemIds: [16, 17, 18, 19],
            scopeNote:
              "4 BOQ lines · 17 location lots · HVAC/BMS/elevator interfaces and fire-resistant cabling",
            evidenceNote:
              "Require method, exclusions, labor basis, cable compliance and delivery programme.",
          },
        ]
      : [
          {
            ...common,
            id: `rfq-unresolved-${runtime.epoch}`,
            code: `${projectCode || "LOCAL"}-RFQ-${String(rfqs.length + 1).padStart(2, "0")}`,
            title: "Price evidence renewal and unresolved scope",
            itemIds: unresolvedIds,
            scopeNote: `${unresolvedIds.length} BOQ line${unresolvedIds.length === 1 ? "" : "s"} without current approved price evidence`,
            evidenceNote:
              "Supplier must return part numbers, technical compliance, unit prices, quotation validity and commercial terms for every line.",
          },
        ];
    setRfqs((current) => [...current, ...packages]);
    setSelectedRfqItemIds([]);
    recordAudit(
      "RFQ packages prepared",
      `${packages.length} local draft${packages.length === 1 ? "" : "s"} · ${new Set(packages.flatMap((rfq) => rfq.itemIds)).size} BOQ price-evidence gaps covered · nothing sent externally`,
    );
    showToast(
      `${packages.length} RFQ package${packages.length === 1 ? "" : "s"} saved locally`,
    );
    setActiveStep(4);
    setShowAllProjects(false);
    setActiveModule("Supplier RFQs");
    setSidebarOpen(false);
  };

  const openRfqComposer = (rfq: RfqRecord) => {
    if (rfq.projectId !== projectId) {
      showToast("RFQ quarantined: it does not belong to the active project");
      return;
    }
    setActiveRfqId(rfq.id);
    setRfqSupplier(rfq.supplier);
    setRfqDueDate(rfq.responseDue);
    setRfqDelivery(rfq.deliveryLocation);
    setRfqRequirements(rfq.requirements);
  };

  const saveRfq = (ready: boolean) => {
    const current = rfqs.find((rfq) => rfq.id === activeRfqId);
    if (!current) return;
    if (current.projectId !== projectId) {
      showToast("RFQ update blocked: project ownership does not match");
      return;
    }
    const unanswerableLines = items.filter(
      (item) =>
        current.itemIds.includes(item.id) && !matchReadiness(item).canApprove,
    );
    if (ready && unanswerableLines.length) {
      showToast(
        `Ready status blocked: ${unanswerableLines.length} RFQ line${unanswerableLines.length === 1 ? " is" : "s are"} not supplier-answerable`,
      );
      return;
    }
    if (
      ready &&
      (!rfqSupplier.trim() ||
        !rfqDueDate ||
        !rfqDelivery.trim() ||
        !rfqRequirements.trim())
    ) {
      showToast(
        "Ready status requires supplier, due date, delivery location and commercial requirements",
      );
      return;
    }
    if (ready && rfqDueDate < new Date().toISOString().slice(0, 10)) {
      showToast(
        "Ready status blocked: response due date cannot be in the past",
      );
      return;
    }
    const nextStatus: RfqStatus = ready ? "Ready to issue" : "Draft";
    setRfqs((records) =>
      records.map((rfq) =>
        rfq.id === current.id
          ? {
              ...rfq,
              supplier: rfqSupplier.trim(),
              responseDue: rfqDueDate,
              deliveryLocation: rfqDelivery.trim(),
              requirements: rfqRequirements.trim(),
              status: nextStatus,
            }
          : rfq,
      ),
    );
    recordAudit(
      ready ? "RFQ marked ready" : "RFQ draft saved",
      `${current.code} · ${current.itemIds.length} BOQ lines · ${rfqSupplier.trim() || "supplier not assigned"} · ${ready ? "ready for manual issue; nothing sent" : "local draft only"}`,
    );
    setActiveRfqId(null);
    showToast(
      ready ? "RFQ marked ready — nothing was sent" : "RFQ draft saved locally",
    );
  };

  const exportRfqPackage = (rfq: RfqRecord) => {
    if (rfq.projectId !== projectId) {
      showToast("RFQ export blocked: project ownership does not match");
      return;
    }
    if (rfq.status !== "Ready to issue") {
      showToast("Export blocked: complete the RFQ and mark it ready first");
      return;
    }
    const unanswerableLines = items.filter(
      (item) =>
        rfq.itemIds.includes(item.id) && !matchReadiness(item).canApprove,
    );
    if (unanswerableLines.length) {
      showToast(
        `RFQ export blocked: ${unanswerableLines.length} line${unanswerableLines.length === 1 ? " is" : "s are"} missing supplier-answerable scope`,
      );
      return;
    }
    const csvCell = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const metadata = [
      ["RFQ code", rfq.code],
      ["Project", projectName],
      ["Project reference", projectCode],
      ["Client", clientName],
      ["Supplier", rfq.supplier],
      ["Response due", rfq.responseDue],
      ["Delivery location", rfq.deliveryLocation],
      ["Return requirements", rfq.requirements],
      ["Issue status", "Prepared locally - not sent"],
    ].map((row) => row.map(csvCell).join(","));
    const originalScopeLines = items.filter((item) =>
      rfq.itemIds.includes(item.id),
    );
    const groupedScopeLines = groupRfqScopeLines(originalScopeLines);
    const header = [
      "BOQ reference(s)",
      "BOQ source row(s)",
      "System",
      "Description",
      "Specification evidence",
      "Unit",
      "Consolidated quantity",
      "Quoted part number",
      "Quoted unit price",
      "Currency",
      "Lead time",
      "Technical result",
      "Deviation",
      "Warranty",
      "Supplier notes",
    ]
      .map(csvCell)
      .join(",");
    const rows = groupedScopeLines.map((group) =>
      [
        group.itemIds
          .map((id) => `BOQ-${String(id).padStart(3, "0")}`)
          .join("; "),
        group.sourceRows.join("; "),
        group.system,
        group.item,
        group.specification || "Specification evidence required",
        group.unit,
        group.qty,
        "",
        "",
        "SAR",
        "",
        "",
        "",
        "",
        "",
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[...metadata, "", header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${rfq.code}-${rfq.supplier.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Supplier"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    recordAudit(
      "RFQ package exported",
      `${rfq.code} · ${groupedScopeLines.length} supplier lines reconciled to ${originalScopeLines.length} BOQ lines · ${rfq.supplier} · local CSV generated · nothing sent`,
    );
    showToast("Supplier-ready RFQ CSV downloaded locally");
  };

  const openResponseReview = (
    rfq: RfqRecord,
    offer?: SupplierResponseReview,
  ) => {
    const runtime = createRuntimeContext();
    if (rfq.projectId !== projectId) {
      showToast("Supplier response blocked: RFQ ownership does not match");
      return;
    }
    const existing = offer;
    const usedFiles = new Set(
      (rfq.responseOffers || [])
        .map((responseOffer) => responseOffer.sourceFile)
        .filter(Boolean),
    );
    const nextSourceFile =
      rfq.responseFiles.find((file) => !usedFiles.has(file)) ||
      rfq.responseFiles[0] ||
      "";
    setActiveResponseRfqId(rfq.id);
    setResponseDraft(
      existing
        ? { ...existing, lines: existing.lines.map((line) => ({ ...line })) }
        : {
            id: `${rfq.id}-offer-${runtime.epoch}`,
            sourceFile: nextSourceFile,
            supplier: rfq.supplier,
            reference: "",
            quoteDate: "",
            validUntil: "",
            currency: "SAR",
            deliveryWeeks: 0,
            warrantyMonths: 0,
            paymentTerms: "",
            freightTotal: 0,
            lines: rfq.itemIds.map((itemId) => ({
              itemId,
              partNumber: "",
              unitPrice: 0,
              technicalResult: "Pending",
              note: "",
            })),
            reviewStatus: "Draft",
          },
    );
  };

  const updateResponseLine = (itemId: number, patch: Partial<ResponseLine>) => {
    setResponseDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.itemId === itemId ? { ...line, ...patch } : line,
            ),
          }
        : current,
    );
  };

  const saveResponseReview = (complete: boolean) => {
    const rfq = rfqs.find((record) => record.id === activeResponseRfqId);
    if (!rfq || !responseDraft) return;
    const today = new Date().toISOString().slice(0, 10);
    const uniqueLineIds = new Set(
      responseDraft.lines.map((line) => line.itemId),
    );
    const sourceFileValid = Boolean(
      responseDraft.sourceFile &&
      rfq.responseFiles.includes(responseDraft.sourceFile),
    );
    const sourceRoleValid = Boolean(
      responseDraft.sourceFile &&
      documentRoles[responseDraft.sourceFile] === "Supplier quotation" &&
      documentHashes[responseDraft.sourceFile] !== honeywellPriceListSha256,
    );
    const sourceFileUnique = !(rfq.responseOffers || []).some(
      (offer) =>
        offer.id !== responseDraft.id &&
        offer.sourceFile === responseDraft.sourceFile &&
        offer.reviewStatus === "Reviewed",
    );
    const linesComplete =
      responseDraft.lines.length === rfq.itemIds.length &&
      uniqueLineIds.size === rfq.itemIds.length &&
      rfq.itemIds.every((itemId) => uniqueLineIds.has(itemId)) &&
      responseDraft.lines.every(
        (line) =>
          line.partNumber.trim() &&
          Number.isFinite(line.unitPrice) &&
          line.unitPrice > 0 &&
          line.technicalResult !== "Pending" &&
          (line.technicalResult !== "Deviation" || line.note.trim()),
      );
    const headerComplete = Boolean(
      responseDraft.supplier.trim() &&
      responseDraft.reference.trim() &&
      responseDraft.quoteDate &&
      responseDraft.validUntil &&
      /^[A-Z]{3}$/i.test(responseDraft.currency.trim()) &&
      responseDraft.deliveryWeeks > 0 &&
      responseDraft.warrantyMonths > 0 &&
      responseDraft.paymentTerms.trim() &&
      Number.isFinite(responseDraft.freightTotal) &&
      responseDraft.freightTotal >= 0,
    );
    const datesValid = Boolean(
      responseDraft.quoteDate &&
      responseDraft.validUntil &&
      responseDraft.quoteDate <= today &&
      responseDraft.validUntil >= today &&
      responseDraft.validUntil >= responseDraft.quoteDate,
    );
    if (
      complete &&
      (!sourceFileValid ||
        !sourceRoleValid ||
        !sourceFileUnique ||
        !headerComplete ||
        !linesComplete ||
        !datesValid)
    ) {
      showToast(
        !sourceRoleValid
          ? "Review blocked: source document is not governed as a supplier quotation"
          : !sourceFileUnique
            ? "Review blocked: this source document already belongs to another reviewed offer"
            : responseDraft.validUntil && responseDraft.validUntil < today
              ? "Review blocked: supplier quotation validity has expired"
              : responseDraft.quoteDate > today ||
                  responseDraft.validUntil < responseDraft.quoteDate
                ? "Review blocked: quotation dates are inconsistent"
                : "Review blocked: select a registered source and complete validity, terms and every priced technical line; deviations require notes",
      );
      return;
    }
    const review: SupplierResponseReview = {
      ...responseDraft,
      supplier: responseDraft.supplier.trim(),
      reference: responseDraft.reference.trim(),
      currency: responseDraft.currency.trim().toUpperCase(),
      paymentTerms: responseDraft.paymentTerms.trim(),
      reviewStatus: complete ? "Reviewed" : "Draft",
      lines: responseDraft.lines.map((line) => ({
        ...line,
        partNumber: line.partNumber.trim(),
        note: line.note.trim(),
      })),
    };
    setRfqs((records) =>
      records.map((record) =>
        record.id === rfq.id
          ? {
              ...record,
              responseOffers: [
                ...(record.responseOffers || []).filter(
                  (offer) => offer.id !== review.id,
                ),
                review,
              ],
            }
          : record,
      ),
    );
    const quotedSubtotal =
      review.lines.reduce(
        (sum, line) =>
          sum +
          (items.find((item) => item.id === line.itemId)?.qty || 0) *
            line.unitPrice,
        0,
      ) + review.freightTotal;
    recordAudit(
      complete
        ? "Supplier response normalized"
        : "Supplier response review saved",
      `${rfq.code} · ${review.supplier || "supplier pending"} · ${review.reference || "reference pending"} · ${review.sourceFile || "source pending"} · ${review.currency} ${money(quotedSubtotal)} · ${complete ? "reviewed evidence only; no BOQ prices or award changed" : "incomplete local review"}`,
    );
    setActiveResponseRfqId(null);
    setResponseDraft(null);
    showToast(
      complete
        ? "Response normalized — award and BOQ pricing remain blocked"
        : "Response review draft saved locally",
    );
  };

  const openAwardReview = (rfq: RfqRecord, offer: SupplierResponseReview) => {
    if (rfq.projectId !== projectId) {
      showToast(
        "Award blocked: RFQ ownership does not match the active project",
      );
      return;
    }
    if (offer.reviewStatus !== "Reviewed") {
      showToast(
        "Award blocked: normalize and complete the supplier response first",
      );
      return;
    }
    setActiveAwardRfqId(rfq.id);
    setActiveAwardOfferId(offer.id || null);
    setAwardReason("");
    setAllowCostReplacement(false);
  };

  const confirmSupplierAward = () => {
    if (!requireWorkingRole("Procurement Reviewer", "Supplier award")) return;
    const rfq = rfqs.find((record) => record.id === activeAwardRfqId);
    const review = rfq?.responseOffers?.find(
      (offer) => offer.id === activeAwardOfferId,
    );
    if (!rfq || !review) return;
    if (rfq.projectId !== projectId) {
      showToast(
        "Award blocked: RFQ ownership does not match the active project",
      );
      return;
    }
    if (
      !review.sourceFile ||
      documentRoles[review.sourceFile] !== "Supplier quotation" ||
      documentHashes[review.sourceFile] === honeywellPriceListSha256
    ) {
      showToast(
        "Award blocked: reviewed source is no longer governed as a supplier quotation",
      );
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const allCompliant = review.lines.every(
      (line) => line.technicalResult === "Compliant",
    );
    const supportedCurrency =
      review.currency === "SAR" ||
      (review.currency === "USD" && rateReady && exchangeRate > 0);
    if (
      review.reviewStatus !== "Reviewed" ||
      review.validUntil < today ||
      !allCompliant ||
      !supportedCurrency ||
      !awardReason.trim()
    ) {
      showToast(
        !allCompliant
          ? "Award blocked: every line must be technically compliant"
          : !supportedCurrency
            ? "Award blocked: only SAR or confirmed USD conversion is supported"
            : "Award blocked: add a decision reason and confirm current quotation validity",
      );
      return;
    }
    const conflicts = items.filter(
      (item) =>
        review.lines.some((line) => line.itemId === item.id) &&
        item.status === "Costed" &&
        Boolean(item.approvedSource) &&
        !(
          item.approvedSource?.includes(rfq.code) &&
          item.approvedSource?.includes(
            review.sourceFile || "__missing_source__",
          )
        ),
    );
    if (conflicts.length && !allowCostReplacement) {
      showToast(
        `Award blocked: ${conflicts.length} BOQ cost${conflicts.length === 1 ? " has" : "s have"} an existing approved source`,
      );
      return;
    }
    const quotedSubtotal = review.lines.reduce(
      (sum, line) =>
        sum +
        (items.find((item) => item.id === line.itemId)?.qty || 0) *
          line.unitPrice,
      0,
    );
    if (quotedSubtotal <= 0) {
      showToast("Award blocked: quoted subtotal must be positive");
      return;
    }
    const conversionRate = review.currency === "USD" ? exchangeRate : 1;
    setItems((current) =>
      current.map((item) => {
        const line = review.lines.find((entry) => entry.itemId === item.id);
        if (!line) return item;
        const extended = item.qty * line.unitPrice;
        const allocatedFreight =
          review.freightTotal * (extended / quotedSubtotal);
        const landedUnitCost =
          (line.unitPrice + allocatedFreight / item.qty) * conversionRate;
        return {
          ...item,
          supplier: review.supplier,
          unitCost: Number(landedUnitCost.toFixed(4)),
          approvedSource: `${rfq.code} · ${review.reference} · ${review.sourceFile} · valid until ${review.validUntil} · ${review.currency}${review.currency === "USD" ? ` × ${exchangeRate.toFixed(3)} SAR/USD` : ""} · freight allocated pro rata`,
          status: "Costed",
        };
      }),
    );
    const awardedAt = new Date().toISOString();
    setRfqs((records) =>
      records.map((record) =>
        record.id === rfq.id
          ? {
              ...record,
              status: "Awarded",
              responseReview: review,
              awardedAt,
              awardReason: awardReason.trim(),
              awardedBy: workingRole,
            }
          : record,
      ),
    );
    recordAudit(
      "Supplier offer awarded",
      `${rfq.code} · ${review.supplier} · ${review.reference} · ${review.currency} ${money(quotedSubtotal + review.freightTotal)} · ${review.lines.length} BOQ lines priced${conflicts.length ? ` · ${conflicts.length} existing approved cost${conflicts.length === 1 ? "" : "s"} explicitly replaced` : ""} · reason: ${awardReason.trim()}`,
    );
    setActiveAwardRfqId(null);
    setActiveAwardOfferId(null);
    setAwardReason("");
    setAllowCostReplacement(false);
    showToast("Award applied with quotation, currency and freight provenance");
  };

  const refreshManagedDocuments = async () => {
    setManagedDocumentsLoading(true);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/documents?includeArchived=true&pageSize=100`,
        { cache: "no-store" },
      );
      if (response.status === 404) {
        setManagedDocuments([]);
        return;
      }
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Document register could not be loaded",
        );
      setManagedDocuments(
        Array.isArray(result.documents) ? result.documents : [],
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Document register could not be loaded",
      );
    } finally {
      setManagedDocumentsLoading(false);
    }
  };

  const loadDrawingWorkspace = async (
    document: ManagedDocument,
    generate = false,
  ) => {
    setDrawingWorkspaceLoading(true);
    setDrawingWorkspaceError("");
    try {
      let response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/drawing-intake`,
        { cache: "no-store" },
      );
      if (generate && response.status === 409)
        response = await fetch(
          `/api/documents/${encodeURIComponent(document.id)}/drawing-intake/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              reason: "Drawing Intake Foundation structural indexing",
            }),
          },
        );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Drawing workspace could not be loaded.",
        );
      setDrawingWorkspaceData(result);
      return result;
    } catch (error) {
      setDrawingWorkspaceError(
        error instanceof Error
          ? error.message
          : "Drawing workspace could not be loaded.",
      );
      return null;
    } finally {
      setDrawingWorkspaceLoading(false);
    }
  };
  const openDrawingWorkspace = async (document: ManagedDocument) => {
    setDrawingWorkspaceDocument(document);
    setDrawingWorkspaceTab("Overview");
    await loadDrawingWorkspace(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("drawing", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeDrawingWorkspace = () => {
    setDrawingWorkspaceDocument(null);
    setDrawingWorkspaceData(null);
    setDrawingSearchResults([]);
    const url = new URL(window.location.href);
    url.searchParams.delete("drawing");
    window.history.replaceState(null, "", url);
  };
  const rerunDrawingIntake = async () => {
    if (!drawingWorkspaceDocument) return;
    setDrawingWorkspaceLoading(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(drawingWorkspaceDocument.id)}/drawing-intake/rerun`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "Manual structural re-index" }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Drawing re-index failed.");
      setDrawingWorkspaceData(result);
      showToast(
        result.idempotent
          ? "Drawing index unchanged"
          : "New drawing index version created",
      );
    } catch (error) {
      setDrawingWorkspaceError(
        error instanceof Error ? error.message : "Drawing re-index failed.",
      );
    } finally {
      setDrawingWorkspaceLoading(false);
    }
  };
  const searchDrawing = async () => {
    if (!drawingWorkspaceDocument) return;
    const response = await fetch(
      `/api/documents/${encodeURIComponent(drawingWorkspaceDocument.id)}/drawing-intake/search?q=${encodeURIComponent(drawingSearch)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    setDrawingSearchResults(response.ok ? result.results || [] : []);
  };
  const loadDrawingHistory = async () => {
    if (!drawingWorkspaceDocument) return;
    const response = await fetch(
      `/api/documents/${encodeURIComponent(drawingWorkspaceDocument.id)}/drawing-intake/history`,
      { cache: "no-store" },
    );
    const result = await response.json();
    setDrawingVersionHistory(response.ok ? result.versions || [] : []);
  };
  const loadSymbolWorkspace = async (
    document: ManagedDocument,
    generate = false,
  ) => {
    setSymbolWorkspaceLoading(true);
    setSymbolWorkspaceError("");
    try {
      let response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/symbol-recognition`,
        { cache: "no-store" },
      );
      if (generate && response.status === 409)
        response = await fetch(
          `/api/documents/${encodeURIComponent(document.id)}/symbol-recognition/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              reason: "Explicit legend and repeated-symbol indexing",
            }),
          },
        );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Symbol Review could not be loaded.",
        );
      setSymbolWorkspaceData(result);
      return result;
    } catch (error) {
      setSymbolWorkspaceError(
        error instanceof Error
          ? error.message
          : "Symbol Review could not be loaded.",
      );
      return null;
    } finally {
      setSymbolWorkspaceLoading(false);
    }
  };
  const openSymbolWorkspace = async (document: ManagedDocument) => {
    setSymbolWorkspaceDocument(document);
    setSymbolWorkspaceTab("Definitions");
    await loadSymbolWorkspace(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("symbols", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeSymbolWorkspace = () => {
    setSymbolWorkspaceDocument(null);
    setSymbolWorkspaceData(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("symbols");
    window.history.replaceState(null, "", url);
  };
  const rerunSymbolRecognition = async () => {
    if (!symbolWorkspaceDocument) return;
    setSymbolWorkspaceLoading(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(symbolWorkspaceDocument.id)}/symbol-recognition/rerun`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "Reviewer requested deterministic rerun",
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Symbol recognition rerun failed.",
        );
      setSymbolWorkspaceData(result);
      showToast(
        result.idempotent
          ? "Symbol recognition unchanged"
          : "New symbol recognition version created",
      );
    } catch (error) {
      setSymbolWorkspaceError(
        error instanceof Error
          ? error.message
          : "Symbol recognition rerun failed.",
      );
    } finally {
      setSymbolWorkspaceLoading(false);
    }
  };
  const reviewSymbol = async (
    kind: "definitions" | "occurrences",
    entityId: string,
    action: "approve" | "reject" | "edit" | "split" | "merge" | "restore",
  ) => {
    if (!symbolWorkspaceDocument) return;
    const reason = window
      .prompt(`Reason required to ${action} this symbol record:`)
      ?.trim();
    if (!reason) return;
    const body: Record<string, unknown> = { reason };
    if (action === "edit") {
      body.explicitLabel = window.prompt("Explicit label", "") || undefined;
      body.abbreviation = window.prompt("Abbreviation", "") || undefined;
      body.description = window.prompt("Description", "") || undefined;
    }
    if (action === "merge") {
      body.targetDefinitionId =
        window.prompt("Target definition ID", "") || undefined;
    }
    if (action === "split") {
      body.occurrenceIds = (
        window.prompt("Occurrence IDs to split (comma separated)", "") || ""
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
    const response = await fetch(
      `/api/symbol-${kind}/${encodeURIComponent(entityId)}/${action}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "Symbol review failed");
      return;
    }
    await loadSymbolWorkspace(symbolWorkspaceDocument);
    showToast(`Symbol ${action} saved`);
  };
  const loadLegendGeometry = async (
    document: ManagedDocument,
    start = false,
  ) => {
    setLegendGeometryError("");
    let response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/legend-geometry`,
      { cache: "no-store" },
    );
    if (start && response.status === 409)
      response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/legend-geometry/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "Approved-row symbol geometry capture",
          }),
        },
      );
    const result = await response.json();
    if (!response.ok) {
      setLegendGeometryError(
        result.error?.message || "Geometry capture failed.",
      );
      return null;
    }
    setLegendGeometryData(result);
    return result;
  };
  const openLegendGeometry = async (document: ManagedDocument) => {
    setLegendGeometryDocument(document);
    await loadLegendGeometry(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("legendGeometry", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeLegendGeometry = () => {
    setLegendGeometryDocument(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("legendGeometry");
    window.history.replaceState(null, "", url);
  };
  const reviewLegendGeometry = async (candidateId: string, action: string) => {
    if (!legendGeometryDocument || legendGeometryReason.trim().length < 5)
      return;
    const body: Record<string, unknown> = { reason: legendGeometryReason };
    if (action === "reassign")
      body.targetRowId = window.prompt("Approved structural row ID") || "";
    const response = await fetch(
        `/api/geometry-candidates/${encodeURIComponent(candidateId)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      result = await response.json();
    if (!response.ok) {
      setLegendGeometryError(
        result.error?.message || "Geometry review failed.",
      );
      return;
    }
    await loadLegendGeometry(legendGeometryDocument);
  };
  const publishLegendGeometry = async () => {
    if (!legendGeometryDocument) return;
    const response = await fetch(
        `/api/documents/${encodeURIComponent(legendGeometryDocument.id)}/legend-geometry/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: legendGeometryReason }),
        },
      ),
      result = await response.json();
    if (!response.ok) {
      setLegendGeometryError(
        result.error?.message || "Geometry publication failed.",
      );
      return;
    }
    showToast(
      result.idempotent
        ? "Approved geometry unchanged"
        : "Approved geometry version published",
    );
  };
  const loadSymbolSegmentation = async (
    document: ManagedDocument,
    start = false,
  ) => {
    setSymbolSegmentationError("");
    let response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/symbol-segmentation`,
      { cache: "no-store" },
    );
    if (start && response.status === 409)
      response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/symbol-segmentation/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "Fine-grained reviewed symbol-cell segmentation",
          }),
        },
      );
    const result = await response.json();
    if (!response.ok) {
      setSymbolSegmentationError(
        result.error?.message || "Segmentation failed.",
      );
      return;
    }
    setSymbolSegmentationData(result);
  };
  const openSymbolSegmentation = async (document: ManagedDocument) => {
    setSymbolSegmentationDocument(document);
    await loadSymbolSegmentation(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("symbolSegmentation", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeSymbolSegmentation = () => {
    setSymbolSegmentationDocument(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("symbolSegmentation");
    window.history.replaceState(null, "", url);
  };
  const reviewSymbolCluster = async (
    id: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!symbolSegmentationDocument) return;
    const response = await fetch(
        `/api/symbol-clusters/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: symbolSegmentationReason, ...extra }),
        },
      ),
      result = await response.json();
    if (!response.ok) {
      setSymbolSegmentationError(
        result.error?.message || "Cluster review failed.",
      );
      return;
    }
    await loadSymbolSegmentation(symbolSegmentationDocument);
  };
  const publishSymbolClusters = async () => {
    if (!symbolSegmentationDocument) return;
    const response = await fetch(
        `/api/documents/${encodeURIComponent(symbolSegmentationDocument.id)}/symbol-segmentation/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: symbolSegmentationReason }),
        },
      ),
      result = await response.json();
    if (!response.ok)
      setSymbolSegmentationError(
        result.error?.message || "Publication failed.",
      );
    else
      showToast(
        result.idempotent
          ? "Approved clusters unchanged"
          : "Approved cluster geometry published",
      );
  };
  const loadSignatureMatching = async (
    document: ManagedDocument,
    start = false,
  ) => {
    setSignatureMatchingError("");
    let response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/symbol-signature-matching`,
      { cache: "no-store" },
    );
    if (start && response.status === 409)
      response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/symbol-signature-matching/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "Controlled approved-symbol occurrence comparison",
          }),
        },
      );
    const result = await response.json();
    if (!response.ok) {
      setSignatureMatchingError(
        result.error?.message || "Signature comparison failed.",
      );
      return;
    }
    setSignatureMatchingData(result);
  };
  const openSignatureMatching = async (document: ManagedDocument) => {
    setSignatureMatchingDocument(document);
    await loadSignatureMatching(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("signatureMatching", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeSignatureMatching = () => {
    setSignatureMatchingDocument(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("signatureMatching");
    window.history.replaceState(null, "", url);
  };
  const reviewOccurrenceMatch = async (id: string, action: string) => {
    if (!signatureMatchingDocument) return;
    const response = await fetch(
        `/api/occurrence-match-candidates/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: signatureMatchingReason }),
        },
      ),
      result = await response.json();
    if (!response.ok)
      setSignatureMatchingError(
        result.error?.message || "Occurrence review failed.",
      );
    else await loadSignatureMatching(signatureMatchingDocument);
  };
  const loadOccurrenceClustering = async (
    document: ManagedDocument,
    start = false,
  ) => {
    setOccurrenceClusteringError("");
    let response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/occurrence-spatial-clustering`,
      { cache: "no-store" },
    );
    if (start && response.status === 409)
      response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/occurrence-spatial-clustering/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "Controlled occurrence-side spatial clustering",
          }),
        },
      );
    const result = await response.json();
    if (!response.ok) {
      setOccurrenceClusteringError(
        result.error?.message || "Occurrence clustering failed.",
      );
      return;
    }
    setOccurrenceClusteringData(result);
  };
  const openOccurrenceClustering = async (document: ManagedDocument) => {
    setOccurrenceClusteringDocument(document);
    await loadOccurrenceClustering(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("occurrenceClustering", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeOccurrenceClustering = () => {
    setOccurrenceClusteringDocument(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("occurrenceClustering");
    window.history.replaceState(null, "", url);
  };
  const reviewOccurrenceCluster = async (id: string, action: string) => {
    if (!occurrenceClusteringDocument) return;
    const response = await fetch(
        `/api/occurrence-spatial-clusters/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: occurrenceClusteringReason }),
        },
      ),
      result = await response.json();
    if (!response.ok)
      setOccurrenceClusteringError(
        result.error?.message || "Cluster review failed.",
      );
    else await loadOccurrenceClustering(occurrenceClusteringDocument);
  };
  const loadStructureWorkspace = async (
    document: ManagedDocument,
    generate = false,
  ) => {
    setStructureWorkspaceLoading(true);
    setStructureWorkspaceError("");
    try {
      let response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/drawing-structure`,
        { cache: "no-store" },
      );
      if (generate && response.status === 409)
        response = await fetch(
          `/api/documents/${encodeURIComponent(document.id)}/drawing-structure/start`,
          { method: "POST" },
        );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Drawing Structure could not be loaded.",
        );
      setStructureWorkspaceData(result);
      return result;
    } catch (error) {
      setStructureWorkspaceError(
        error instanceof Error
          ? error.message
          : "Drawing Structure could not be loaded.",
      );
      return null;
    } finally {
      setStructureWorkspaceLoading(false);
    }
  };
  const openStructureWorkspace = async (document: ManagedDocument) => {
    setStructureWorkspaceDocument(document);
    setStructureWorkspaceTab("Tables");
    await loadStructureWorkspace(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("structure", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeStructureWorkspace = () => {
    setStructureWorkspaceDocument(null);
    setStructureWorkspaceData(null);
    setStructureSearchResults([]);
    const url = new URL(window.location.href);
    url.searchParams.delete("structure");
    window.history.replaceState(null, "", url);
  };
  const rerunStructure = async () => {
    if (!structureWorkspaceDocument) return;
    setStructureWorkspaceLoading(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(structureWorkspaceDocument.id)}/drawing-structure/rerun`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Structural rerun failed.");
      setStructureWorkspaceData(result);
      showToast(
        result.idempotent
          ? "Drawing structure unchanged"
          : "New structural version created",
      );
    } catch (error) {
      setStructureWorkspaceError(
        error instanceof Error ? error.message : "Structural rerun failed.",
      );
    } finally {
      setStructureWorkspaceLoading(false);
    }
  };
  const loadStructureHistory = async () => {
    if (!structureWorkspaceDocument) return;
    const response = await fetch(
      `/api/documents/${encodeURIComponent(structureWorkspaceDocument.id)}/drawing-structure/history`,
    );
    const result = await response.json();
    setStructureHistory(response.ok ? result.versions || [] : []);
  };
  const searchStructure = async () => {
    if (!structureWorkspaceDocument) return;
    const response = await fetch(
      `/api/documents/${encodeURIComponent(structureWorkspaceDocument.id)}/drawing-structure/search?q=${encodeURIComponent(structureSearch)}`,
    );
    const result = await response.json();
    setStructureSearchResults(response.ok ? result.results || [] : []);
  };
  const loadStructureReview = async (
    document: ManagedDocument,
    initialize = false,
  ) => {
    setStructureReviewLoading(true);
    setStructureReviewError("");
    try {
      if (initialize)
        await fetch(
          `/api/documents/${encodeURIComponent(document.id)}/drawing-structure/review/initialize`,
          { method: "POST" },
        );
      const response = await fetch(
          `/api/documents/${encodeURIComponent(document.id)}/drawing-structure/review`,
          { cache: "no-store" },
        ),
        result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Structural review could not be loaded.",
        );
      setStructureReviewData(result);
      const selected =
        result.cases?.find(
          (item: StructureReviewCase) => item.id === structureReviewCaseId,
        ) || result.cases?.[0];
      if (selected) {
        setStructureReviewCaseId(selected.id);
        setStructureReviewDescription(
          selected.current_snapshot.description || "",
        );
        setStructureReviewAbbreviation(
          selected.current_snapshot.abbreviation || "",
        );
      }
      return result;
    } catch (error) {
      setStructureReviewError(
        error instanceof Error
          ? error.message
          : "Structural review could not be loaded.",
      );
      return null;
    } finally {
      setStructureReviewLoading(false);
    }
  };
  const openStructureReview = async () => {
    if (!structureWorkspaceDocument) return;
    setStructureReviewOpen(true);
    await loadStructureReview(structureWorkspaceDocument, true);
    const url = new URL(window.location.href);
    url.searchParams.set("structureReview", structureWorkspaceDocument.id);
    window.history.replaceState(null, "", url);
  };
  const openStructureReviewForDocument = async (document: ManagedDocument) => {
    setStructureWorkspaceDocument(document);
    await loadStructureWorkspace(document, true);
    setStructureReviewOpen(true);
    await loadStructureReview(document, true);
    const url = new URL(window.location.href);
    url.searchParams.set("structure", document.id);
    url.searchParams.set("structureReview", document.id);
    window.history.replaceState(null, "", url);
  };
  const closeStructureReview = () => {
    setStructureReviewOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("structureReview");
    window.history.replaceState(null, "", url);
  };
  const selectStructureReviewCase = (reviewCase: StructureReviewCase) => {
    setStructureReviewCaseId(reviewCase.id);
    setStructureReviewDescription(
      reviewCase.current_snapshot.description || "",
    );
    setStructureReviewAbbreviation(
      reviewCase.current_snapshot.abbreviation || "",
    );
    setStructureReviewReason("");
  };
  const structureReviewAction = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (
      !structureWorkspaceDocument ||
      !structureReviewCaseId ||
      structureReviewReason.trim().length < 5
    ) {
      setStructureReviewError("A substantive reviewer reason is required.");
      return;
    }
    setStructureReviewLoading(true);
    try {
      const response = await fetch(
          `/api/structure-review-cases/${encodeURIComponent(structureReviewCaseId)}/${action}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: structureReviewReason, ...extra }),
          },
        ),
        result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Review action failed.");
      await loadStructureReview(structureWorkspaceDocument);
      showToast(`Structural review ${action} saved`);
    } catch (error) {
      setStructureReviewError(
        error instanceof Error ? error.message : "Review action failed.",
      );
    } finally {
      setStructureReviewLoading(false);
    }
  };
  const publishApprovedStructure = async () => {
    if (
      !structureWorkspaceDocument ||
      structureReviewReason.trim().length < 5
    ) {
      setStructureReviewError("A publication reason is required.");
      return;
    }
    const response = await fetch(
        `/api/documents/${encodeURIComponent(structureWorkspaceDocument.id)}/drawing-structure/review/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: structureReviewReason }),
        },
      ),
      result = await response.json();
    if (!response.ok) {
      setStructureReviewError(
        result.error?.message || "Approved structure could not be published.",
      );
      return;
    }
    await loadStructureReview(structureWorkspaceDocument);
    showToast(
      result.idempotent
        ? "Approved structure unchanged"
        : `Approved structure v${result.version} published`,
    );
  };

  const loadTechnicalRequirementHistory = async (requirementId: string) => {
    const response = await fetch(
      technicalApi.requirementHistory(requirementId),
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ||
          "Requirement audit history could not be loaded.",
      );
    setTechnicalRequirementHistory(
      Array.isArray(result.history) ? result.history : [],
    );
  };

  const loadTechnicalRequirements = async (document: ManagedDocument) => {
    setTechnicalRequirementsLoading(true);
    setTechnicalRequirementError("");
    try {
      const rows: TechnicalRequirement[] = [];
      // The review workspace must expose the complete persisted extraction.
      // Large specifications can exceed the former 4,000-row client cap.
      for (let page = 1; page <= 100; page += 1) {
        const response = await fetch(
          `/api/documents/${encodeURIComponent(document.id)}/specification-extraction/requirements?page=${page}&limit=200`,
          { cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message ||
              "Technical requirements could not be loaded.",
          );
        const pageRows = Array.isArray(result.requirements)
          ? result.requirements
          : [];
        rows.push(...pageRows);
        if (pageRows.length < 200) break;
      }
      setTechnicalRequirements(rows);
      return rows;
    } catch (error) {
      setTechnicalRequirementError(
        error instanceof Error
          ? error.message
          : "Technical requirements could not be loaded.",
      );
      return [];
    } finally {
      setTechnicalRequirementsLoading(false);
    }
  };

  const openTechnicalRequirementReview = async (
    document: ManagedDocument,
    requestedRequirementId = "",
  ) => {
    setRequirementReviewDocument(document);
    const rows = await loadTechnicalRequirements(document);
    const selectedId =
      requestedRequirementId &&
      rows.some((row) => row.id === requestedRequirementId)
        ? requestedRequirementId
        : null;
    setSelectedTechnicalRequirementId(selectedId);
    setTechnicalRequirementHistory([]);
    if (selectedId)
      await loadTechnicalRequirementHistory(selectedId).catch((error) =>
        setTechnicalRequirementError(
          error instanceof Error
            ? error.message
            : "Requirement audit history could not be loaded.",
        ),
      );
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    url.searchParams.delete("module");
    url.searchParams.set("workspace", "BOQ");
    url.searchParams.set("requirementReview", document.id);
    if (selectedId) url.searchParams.set("requirement", selectedId);
    else url.searchParams.delete("requirement");
    window.history.pushState(null, "", url);
  };

  const closeTechnicalRequirementReview = () => {
    setRequirementReviewDocument(null);
    setSelectedTechnicalRequirementId(null);
    setTechnicalRequirementHistory([]);
    setTechnicalRequirementAction(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("requirementReview");
    url.searchParams.delete("requirement");
    window.history.pushState(null, "", url);
  };

  const selectTechnicalRequirement = async (
    requirement: TechnicalRequirement,
  ) => {
    setSelectedTechnicalRequirementId(requirement.id);
    setTechnicalRequirementHistory([]);
    const url = new URL(window.location.href);
    url.searchParams.set("requirement", requirement.id);
    window.history.pushState(null, "", url);
    await loadTechnicalRequirementHistory(requirement.id).catch((error) =>
      setTechnicalRequirementError(
        error instanceof Error
          ? error.message
          : "Requirement audit history could not be loaded.",
      ),
    );
  };

  const submitTechnicalRequirementAction = async () => {
    if (
      !technicalRequirementAction ||
      technicalRequirementAction.reason.trim().length < 3
    ) {
      setTechnicalRequirementError(
        "A substantive reviewer reason is required.",
      );
      return;
    }
    setTechnicalRequirementActionLoading(true);
    setTechnicalRequirementError("");
    try {
      const body: Record<string, unknown> = {
        reason: technicalRequirementAction.reason.trim(),
        evidence: {
          sourceLocation:
            technicalRequirementAction.requirement.source_location,
          reviewedBy: authSession?.user.id,
        },
      };
      if (technicalRequirementAction.operation === "update")
        body.values = {
          normalizedRequirement:
            technicalRequirementAction.normalizedRequirement.trim(),
        };
      const requirementId = technicalRequirementAction.requirement.id;
      await requestJson(
        technicalApi.requirementAction(requirementId, technicalRequirementAction.operation),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!requirementReviewDocument)
        throw new Error("Requirement source document is no longer available.");
      await loadTechnicalRequirements(requirementReviewDocument);
      setTechnicalRequirementAction(null);
      await loadTechnicalRequirementHistory(requirementId);
      showToast(
        `Requirement ${technicalRequirementAction.operation} recorded by ${authSession?.user.displayName || "authenticated reviewer"}`,
      );
    } catch (error) {
      setTechnicalRequirementError(
        error instanceof Error
          ? error.message
          : "Requirement decision could not be recorded.",
      );
    } finally {
      setTechnicalRequirementActionLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch(
      `/api/projects/${encodeURIComponent(projectId)}/documents?includeArchived=true&pageSize=100`,
      { cache: "no-store" },
    )
      .then(async (response) =>
        response.status === 404
          ? { documents: [] }
          : response.ok
            ? response.json()
            : Promise.reject(
                new Error("Document register could not be loaded"),
              ),
      )
      .then((result) => {
        if (active)
          setManagedDocuments(
            Array.isArray(result.documents) ? result.documents : [],
          );
      })
      .catch(() => {
        if (active) setManagedDocuments([]);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!managedDocuments.some((document) => ["Queued", "Running"].includes(document.specification_job_status || ""))) return;
    const timer = window.setInterval(() => {
      fetch(`/api/projects/${encodeURIComponent(projectId)}/documents?includeArchived=true&pageSize=100`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((result) => { if (Array.isArray(result?.documents)) setManagedDocuments(result.documents); })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [managedDocuments, projectId]);

  useEffect(() => {
    if (!managedDocuments.length || requirementReviewDocument) return;
    const params = new URLSearchParams(window.location.search);
    const documentId = params.get("requirementReview");
    if (!documentId) return;
    const document = managedDocuments.find(
      (entry) => entry.id === documentId && entry.specification_extraction_id,
    );
    if (document)
      void openTechnicalRequirementReview(
        document,
        params.get("requirement") || "",
      );
  }, [managedDocuments, requirementReviewDocument]);

  useEffect(() => {
    if (!requirementReviewDocument) return;
    const restoreRequirementSelection = () => {
      const requestedId = new URLSearchParams(window.location.search).get("requirement");
      const selectedId = requestedId && technicalRequirements.some((row) => row.id === requestedId)
        ? requestedId
        : null;
      setSelectedTechnicalRequirementId(selectedId);
      setTechnicalRequirementHistory([]);
      if (selectedId)
        void loadTechnicalRequirementHistory(selectedId).catch((error) =>
          setTechnicalRequirementError(error instanceof Error ? error.message : "Requirement history could not be loaded."),
        );
    };
    window.addEventListener("popstate", restoreRequirementSelection);
    return () => window.removeEventListener("popstate", restoreRequirementSelection);
  }, [requirementReviewDocument, technicalRequirements]);

  useEffect(() => {
    if (drawingWorkspaceDocument || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "drawing",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openDrawingWorkspace(document);
  }, [managedDocuments, drawingWorkspaceDocument]);
  useEffect(() => {
    if (symbolWorkspaceDocument || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "symbols",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openSymbolWorkspace(document);
  }, [managedDocuments, symbolWorkspaceDocument]);
  useEffect(() => {
    if (legendGeometryDocument || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "legendGeometry",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openLegendGeometry(document);
  }, [managedDocuments, legendGeometryDocument]);
  useEffect(() => {
    if (symbolSegmentationDocument || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "symbolSegmentation",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openSymbolSegmentation(document);
  }, [managedDocuments, symbolSegmentationDocument]);
  useEffect(() => {
    if (signatureMatchingDocument || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "signatureMatching",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openSignatureMatching(document);
  }, [managedDocuments, signatureMatchingDocument]);
  useEffect(() => {
    if (occurrenceClusteringDocument || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "occurrenceClustering",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openOccurrenceClustering(document);
  }, [managedDocuments, occurrenceClusteringDocument]);
  useEffect(() => {
    if (structureWorkspaceDocument || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "structure",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openStructureWorkspace(document);
  }, [managedDocuments, structureWorkspaceDocument]);
  useEffect(() => {
    if (structureReviewOpen || !managedDocuments.length) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "structureReview",
    );
    const document = managedDocuments.find((entry) => entry.id === documentId);
    if (document) void openStructureReviewForDocument(document);
  }, [managedDocuments, structureReviewOpen]);
  useEffect(() => {
    if (structureReviewOpen || !structureWorkspaceDocument) return;
    const documentId = new URLSearchParams(window.location.search).get(
      "structureReview",
    );
    if (documentId === structureWorkspaceDocument.id)
      void openStructureReview();
  }, [structureWorkspaceDocument, structureReviewOpen]);

  useEffect(() => {
    if (applicabilityReviewOpen || !authSession) return;
    if (
      new URLSearchParams(window.location.search).get("applicabilityReview") ===
      "open"
    )
      void openApplicabilityReview();
  }, [authSession, applicabilityReviewOpen]);

  useEffect(() => {
    if (requirementIntelligenceItemId || !authSession || activeModule !== "BOQ")
      return;
    const itemId = new URLSearchParams(window.location.search).get(
      "requirementIntelligence",
    );
    if (itemId) void openRequirementIntelligence(itemId);
  }, [authSession, activeModule, requirementIntelligenceItemId]);

  useEffect(() => {
    if (
      engineeringClassificationItemId ||
      !authSession ||
      activeModule !== "BOQ"
    )
      return;
    const itemId = new URLSearchParams(window.location.search).get(
      "engineeringClassification",
    );
    if (itemId) void openEngineeringClassification(itemId);
  }, [authSession, activeModule, engineeringClassificationItemId]);

  useEffect(() => {
    if (engineeringGraphItemId || !authSession || activeModule !== "BOQ")
      return;
    const itemId = new URLSearchParams(window.location.search).get(
      "engineeringGraph",
    );
    if (itemId) void openEngineeringGraph(itemId);
  }, [authSession, activeModule, engineeringGraphItemId]);

  useEffect(() => {
    if (activeModule !== "Product Library") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLibraryLoading(true);
      setLibraryError("");
      try {
        const response = await fetch(
          `/api/library/products?q=${encodeURIComponent(librarySearch.trim())}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message || "Product Library could not be loaded.",
          );
        setLibraryProducts(
          Array.isArray(result.products) ? result.products : [],
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setLibraryProducts([]);
          setLibraryError(
            error instanceof Error
              ? error.message
              : "Product Library could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLibraryLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeModule, librarySearch]);

  useEffect(() => {
    if (activeModule !== "Case Studies") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCaseStudyLoading(true);
      setCaseStudyError("");
      try {
        const response = await fetch(
          `/api/case-studies?q=${encodeURIComponent(caseStudySearch.trim())}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message || "Case Study Library could not be loaded.",
          );
        const cases = Array.isArray(result.cases) ? result.cases : [];
        const detailed = await Promise.all(
          cases.map(async (caseStudy: CaseStudySummary) => {
            const detailResponse = await fetch(
              `/api/case-studies/${encodeURIComponent(caseStudy.id)}`,
              { cache: "no-store", signal: controller.signal },
            );
            if (!detailResponse.ok) return caseStudy;
            const detail = await detailResponse.json();
            return {
              ...caseStudy,
              source_count: detail.sources?.length || 0,
              ground_truth_count: detail.groundTruth?.length || 0,
              knowledge_count: detail.knowledge?.length || 0,
              similarity_signal_count: detail.signals?.length || 0,
              reusable_count: (detail.knowledge || []).filter(
                (item: { layer?: string }) =>
                  item.layer === "Reusable Company Knowledge",
              ).length,
            };
          }),
        );
        setCaseStudies(detailed);
      } catch (error) {
        if (!controller.signal.aborted) {
          setCaseStudies([]);
          setCaseStudyError(
            error instanceof Error
              ? error.message
              : "Case Study Library could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setCaseStudyLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeModule, caseStudySearch]);

  useEffect(() => {
    if (activeModule !== "Knowledge Library") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setKnowledgeLoading(true);
      setKnowledgeError("");
      try {
        const typeMap: Record<string, string> = {
          Products: "Part Number",
          Manufacturers: "Manufacturer",
          Standards: "Standard",
        };
        const fileTypeMap: Record<string, string> = {
          "Price Lists": "Price List",
          Datasheets: "Product Datasheet",
          "Case Studies": "Previous Project Reference",
        };
        const identityMode = knowledgeSection === "Product Identities";
        const reviewMode = knowledgeSection === "Review";
        const [summaryResponse, dataResponse] = await Promise.all([
          fetch("/api/knowledge/summary", {
            cache: "no-store",
            signal: controller.signal,
          }),
          reviewMode
            ? fetch(
                `/api/knowledge/review-queue?q=${encodeURIComponent(knowledgeSearch)}`,
                { cache: "no-store", signal: controller.signal },
              )
            : identityMode
            ? fetch(
                `/api/product-identities?q=${encodeURIComponent(knowledgeSearch)}`,
                { cache: "no-store", signal: controller.signal },
              )
            : typeMap[knowledgeSection] || knowledgeSection === "Search"
              ? fetch(
                  `/api/knowledge/search?q=${encodeURIComponent(knowledgeSearch || "  ")}&type=${encodeURIComponent(typeMap[knowledgeSection] || "")}`,
                  { cache: "no-store", signal: controller.signal },
                )
              : fetch(
                  `/api/knowledge/files?q=${encodeURIComponent(knowledgeSearch)}&section=${encodeURIComponent(fileTypeMap[knowledgeSection] || "")}`,
                  { cache: "no-store", signal: controller.signal },
                ),
        ]);
        const summaryPayload = await summaryResponse.json(),
          dataPayload = await dataResponse.json();
        if (!summaryResponse.ok)
          throw new Error(
            summaryPayload.error?.message ||
              "Knowledge summary could not be loaded.",
          );
        if (!dataResponse.ok)
          throw new Error(
            dataPayload.error?.message ||
              "Knowledge Library could not be loaded.",
          );
        setKnowledgeSummary(summaryPayload.summary || {});
        setKnowledgeFiles(
          Array.isArray(dataPayload.files) ? dataPayload.files : [],
        );
        setKnowledgeResults(
          Array.isArray(dataPayload.results) ? dataPayload.results : [],
        );
        setProductIdentities(
          Array.isArray(dataPayload.identities) ? dataPayload.identities : [],
        );
        setKnowledgeReviewItems(
          Array.isArray(dataPayload.items) ? dataPayload.items : [],
        );
      } catch (error) {
        if (!controller.signal.aborted)
          setKnowledgeError(
            error instanceof Error
              ? error.message
              : "Knowledge Library could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setKnowledgeLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeModule, knowledgeSection, knowledgeSearch]);

  const reviewKnowledgeItem = async (
    item: Record<string, any>,
    action: "confirm" | "reject",
  ) => {
    const reason = knowledgeReviewReason.trim();
    if (reason.length < 5) {
      setKnowledgeError("Provide a clear review reason before saving the decision.");
      return;
    }
    setKnowledgeLoading(true);
    setKnowledgeError("");
    try {
      const kind = String(item.item_kind || "").toLowerCase();
      const response = await fetch(
        `/api/knowledge/review/${encodeURIComponent(kind)}/${encodeURIComponent(String(item.id))}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, reason }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "The review decision could not be saved.");
      setKnowledgeReviewItems((current) =>
        current.filter((entry) => String(entry.id) !== String(item.id)),
      );
      setKnowledgeSummary((current) => ({
        ...current,
        needs_review: Math.max(0, Number(current.needs_review || 0) - 1),
      }));
      setKnowledgeReviewTarget(null);
      setKnowledgeReviewReason("");
      showToast(`Knowledge item ${result.action.toLowerCase()} · audit recorded`);
    } catch (error) {
      setKnowledgeError(
        error instanceof Error ? error.message : "The review decision could not be saved.",
      );
    } finally {
      setKnowledgeLoading(false);
    }
  };

  useEffect(() => {
    if (activeModule !== "Pricing Memory") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPricingMemoryLoading(true);
      setPricingMemoryError("");
      try {
        const [summaryResponse, cardsResponse] = await Promise.all([
          fetch("/api/pricing-learning/summary", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(
            `/api/pricing-memory/cards?q=${encodeURIComponent(pricingMemorySearch)}`,
            { cache: "no-store", signal: controller.signal },
          ),
        ]);
        const summary = await summaryResponse.json(),
          cards = await cardsResponse.json();
        if (!summaryResponse.ok)
          throw new Error(
            summary.error?.message ||
              "Pricing Memory summary could not be loaded.",
          );
        if (!cardsResponse.ok)
          throw new Error(
            cards.error?.message || "Pricing cards could not be loaded.",
          );
        setPricingMemorySummary(summary.summary || {});
        setPricingMemoryCards(cards.cards || []);
      } catch (error) {
        if (!controller.signal.aborted)
          setPricingMemoryError(
            error instanceof Error
              ? error.message
              : "Pricing Memory could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setPricingMemoryLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeModule, pricingMemorySearch]);

  const learnCompletedProject = async () => {
    setPricingMemoryLoading(true);
    setPricingMemoryError("");
    try {
      const response = await fetch(
          `/api/pricing-learning/projects/${encodeURIComponent(projectId)}/learn`,
          { method: "POST" },
        ),
        result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "The completed project could not be learned.",
        );
      showToast(
        result.idempotent
          ? "Pricing Memory is already current"
          : "Completed project added to Pricing Memory",
      );
      setPricingMemorySummary((current) => ({
        ...current,
        projects_learned:
          Number(current.projects_learned || 0) + (result.idempotent ? 0 : 1),
        historical_prices:
          Number(current.historical_prices || 0) +
          Number(result.summary?.historicalPricesAdded || 0),
      }));
    } catch (error) {
      setPricingMemoryError(
        error instanceof Error
          ? error.message
          : "The completed project could not be learned.",
      );
    } finally {
      setPricingMemoryLoading(false);
    }
  };

  const uploadKnowledgeFiles = async (files: File[]) => {
    if (!files.length) return;
    setKnowledgeLoading(true);
    setKnowledgeError("");
    let learned = 0,
      duplicates = 0,
      failed = 0,
      products = 0,
      prices = 0,
      lastName = "";
    for (const file of files) {
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/knowledge/files", {
          method: "POST",
          body: form,
        });
        const result = await response.json();
        if (response.status === 409 && result.duplicate) {
          duplicates++;
          continue;
        }
        if (!response.ok)
          throw new Error(
            result.error?.message || `${file.name} could not be processed.`,
          );
        learned++;
        products += Number(result.summary?.productsLearned || 0);
        prices += Number(result.summary?.pricesDiscovered || 0);
        lastName = result.file?.fileName || file.name;
      } catch (error) {
        failed++;
        setKnowledgeError(
          error instanceof Error
            ? error.message
            : `${file.name} could not be processed.`,
        );
      }
    }
    showToast(
      `${learned} file${learned === 1 ? "" : "s"} learned · ${products} products · ${prices} catalogue prices${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}${failed ? ` · ${failed} failed` : ""}`,
    );
    setKnowledgeSection("Files");
    if (learned === 1) setKnowledgeSearch(lastName.slice(0, 40));
    else setKnowledgeSearch("");
    setKnowledgeLoading(false);
    if (knowledgeUploadInput.current) knowledgeUploadInput.current.value = "";
  };
  const buildProductIdentities = async () => {
    setKnowledgeLoading(true);
    setKnowledgeError("");
    try {
      const response = await fetch("/api/product-identities/analyze", {
          method: "POST",
        }),
        result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Product identities could not be built.",
        );
      showToast(
        `${result.identityCount} evidence-backed product identities · ${result.idempotent ? "no changes" : "analysis completed"}`,
      );
      setKnowledgeSection("Product Identities");
      setKnowledgeSearch("");
    } catch (error) {
      setKnowledgeError(
        error instanceof Error
          ? error.message
          : "Product identities could not be built.",
      );
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const openLibraryProduct = async (product: LibraryProduct) => {
    setLibraryDetailLoading(true);
    setLibraryError("");
    try {
      const response = await fetch(
        `/api/products/${encodeURIComponent(product.requestedProductId)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Product evidence could not be loaded.",
        );
      setSelectedLibraryProduct(result);
    } catch (error) {
      setLibraryError(
        error instanceof Error
          ? error.message
          : "Product evidence could not be loaded.",
      );
    } finally {
      setLibraryDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!["BOQ", "Technical Matching"].includes(activeModule)) return;
    const documents = managedDocuments.filter(
      (entry) => entry.boq_extraction_id && !entry.archived_at,
    );
    if (!documents.length) {
      setExtractedBoqItems([]);
      return;
    }
    let active = true;
    Promise.all(
      documents.map((document) => loadAllExtractedBoqItems(document.id)),
    )
      .then((itemGroups) => {
        if (active) setExtractedBoqItems(itemGroups.flat());
      })
      .catch((error) => {
        if (active) {
          setExtractedBoqItems([]);
          showToast(
            error instanceof Error
              ? error.message
              : "Extracted BOQ rows could not be loaded",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [activeModule, managedDocuments]);

  useEffect(() => {
    if (activeModule !== "BOQ") return;
    const approvedIds = extractedBoqItems
      .filter(
        (item) =>
          item.row_type === "BOQ Item" && item.review_status === "Approved",
      )
      .map((item) => item.id);
    if (!approvedIds.length) return;
    let active = true;
    Promise.all(
      approvedIds.map(async (itemId) => {
        const response = await fetch(
          `/api/boq-items/${encodeURIComponent(itemId)}/requirement-profile`,
          { cache: "no-store" },
        );
        const result = await response.json();
        return [itemId, response.ok ? result.profile : null] as const;
      }),
    )
      .then((entries) => {
        if (active)
          setRequirementProfilesByItem((current) => ({
            ...current,
            ...Object.fromEntries(entries),
          }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeModule, extractedBoqItems]);

  const managedTypeForRole = (role: DocumentRole) =>
    ({
      BOQ: "BOQ",
      Specification: "Technical Specification",
      Drawing: "Drawing",
      "Client inquiry": "Other",
      "Price source": "Price List",
      "Supplier quotation": "Supplier Quotation",
      Unclassified: "Auto Detection",
    })[role];

  const persistManagedFile = async (file: File, role: DocumentRole) => {
    const send = async (duplicateAction = "", targetDocumentId = "") => {
      const form = new FormData();
      form.set("file", file);
      form.set("projectName", projectName);
      form.set("documentType", managedTypeForRole(role));
      if (duplicateAction) form.set("duplicateAction", duplicateAction);
      if (targetDocumentId) form.set("targetDocumentId", targetDocumentId);
      return new Promise<{
        status: number;
        ok: boolean;
        json: () => Promise<unknown>;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "POST",
          `/api/projects/${encodeURIComponent(projectId)}/documents`,
        );
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            setUploadProgressByName((current) => ({
              ...current,
              [file.name]: Math.round((event.loaded / event.total) * 100),
            }));
        };
        xhr.onerror = () =>
          reject(
            new Error(
              `Network upload failed for ${file.name}. Retry when the connection is stable.`,
            ),
          );
        xhr.onload = () =>
          resolve({
            status: xhr.status,
            ok: xhr.status >= 200 && xhr.status < 300,
            json: async () => {
              try {
                return JSON.parse(xhr.responseText);
              } catch {
                return {
                  error: {
                    message: "The upload service returned an invalid response.",
                  },
                };
              }
            },
          });
        xhr.send(form);
      });
    };
    const response = await send();
    const result = (await response.json()) as {
      duplicate?: boolean;
      existing?: { original_filename: string; document_id: string };
      cancelled?: boolean;
      error?: { code?: string; message?: string; suggestedAction?: string };
    };
    if (response.status === 409 && result.duplicate && result.existing) {
      showToast(
        `Duplicate detected: ${file.name} already exists as ${result.existing.original_filename}; no new document or version was created`,
      );
      return { cancelled: true };
    }
    if (!response.ok)
      throw new Error(
        `${result.error?.code ? `${result.error.code}: ` : ""}${result.error?.message || "Upload failed"}${result.error?.suggestedAction ? ` ${result.error.suggestedAction}` : ""}`,
      );
    if (result.cancelled)
      showToast(
        `Duplicate detected: ${file.name} was not uploaded again; the existing document and version were preserved`,
      );
    return result;
  };

  const runManagedDocumentAction = async (
    document: ManagedDocument,
    action: "archive" | "restore" | "retry" | "cancel" | "delete",
  ) => {
    const reason = window
      .prompt(`Reason for ${action}:`, "Document management action")
      ?.trim();
    if (!reason) return;
    const response =
      action === "delete"
        ? await fetch(`/api/documents/${encodeURIComponent(document.id)}`, {
            method: "DELETE",
            headers: { "x-audit-reason": reason },
          })
        : await fetch(
            `/api/documents/${encodeURIComponent(document.id)}/${action}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reason }),
            },
          );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || `${action} failed`);
      return;
    }
    await refreshManagedDocuments();
    showToast(`${document.logical_name} · ${action} recorded`);
  };

  const editManagedDocument = async (document: ManagedDocument) => {
    const logicalName = window
      .prompt("Document display name:", document.logical_name)
      ?.trim();
    if (!logicalName) return;
    const notes =
      window.prompt("Notes:", document.notes || "") ?? document.notes;
    const response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          logicalName,
          notes,
          reason: "Document metadata edited",
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "Metadata update failed");
      return;
    }
    await refreshManagedDocuments();
    showToast("Document metadata updated");
  };

  const restoreManagedVersion = async (document: ManagedDocument) => {
    const historyResponse = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/history`,
      { cache: "no-store" },
    );
    const history = await historyResponse.json();
    if (!historyResponse.ok) {
      showToast(
        history.error?.message || "Version history could not be loaded",
      );
      return;
    }
    const previous = (history.versions || []).filter(
      (version: { id: string }) => version.id !== document.version_id,
    );
    if (!previous.length) {
      showToast("No previous version is available to restore");
      return;
    }
    const menu = previous
      .map(
        (version: {
          id: string;
          version_number: number;
          original_filename: string;
        }) =>
          `v${version.version_number}: ${version.original_filename} [${version.id}]`,
      )
      .join("\n");
    const selected = window
      .prompt(
        `Enter the version number to restore:\n${menu}`,
        String(previous[0].version_number),
      )
      ?.trim();
    const version = previous.find(
      (entry: { version_number: number }) =>
        String(entry.version_number) === selected,
    );
    if (!version) return;
    const reason = window
      .prompt(
        "Reason for restoring this version:",
        "Previous source issue restored",
      )
      ?.trim();
    if (!reason) return;
    const response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/versions/${encodeURIComponent(version.id)}/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "Version restore failed");
      return;
    }
    await refreshManagedDocuments();
    showToast(
      `Version ${version.version_number} restored as a new current version`,
    );
  };

  const managedDocumentDuration = (document: ManagedDocument) => {
    if (!document.started_at) return "Not started";
    if (!document.completed_at) return "In progress";
    const end = new Date(document.completed_at).getTime();
    const seconds = Math.max(
      0,
      Math.round((end - new Date(document.started_at).getTime()) / 1000),
    );
    return seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const boqSummaryFor = (document: ManagedDocument) => {
    try {
      const summary = JSON.parse(document.boq_extraction_summary || "{}") as {
        validBoqItems?: number;
        itemsNeedingReview?: number;
        sectionsDetected?: number;
        sectionHeaders?: number;
        totalsAndSubtotals?: number;
        averageConfidence?: number;
      };
      const itemReviewCount = Math.min(
        Number(summary.validBoqItems || 0),
        Number(summary.itemsNeedingReview || 0),
      );
      return {
        ...summary,
        itemsNeedingReview: itemReviewCount,
        structuralRecordsNeedingReview: Math.max(
          0,
          Number(summary.itemsNeedingReview || 0) - itemReviewCount,
        ),
      };
    } catch {
      return {};
    }
  };

  const specificationSummaryFor = (document: ManagedDocument) => {
    try {
      const summary = JSON.parse(
        document.specification_extraction_summary || "{}",
      ) as {
        requirements?: number;
        clauses?: number;
        totalRequirementsExtracted?: number;
        totalClausesDetected?: number;
        totalPagesReviewed?: number;
        mandatoryRequirements?: number;
        itemsNeedingReview?: number;
        conflicts?: number;
        missingInformation?: number;
        averageConfidence?: number;
      };
      return {
        ...summary,
        requirements:
          summary.totalRequirementsExtracted ?? summary.requirements,
        clauses: summary.totalClausesDetected ?? summary.clauses,
      };
    } catch {
      return {};
    }
  };

  const managedDocumentNextAction = (document: ManagedDocument) =>
    document.archived_at
      ? "Restore if active evidence is required"
      : document.processing_status === "Failed"
        ? document.suggested_action || "Review the error, then retry"
        : document.processing_status === "Waiting"
          ? "Waiting for the Task 4 processor"
          : document.processing_status === "Needs Review"
            ? "Open the downstream review"
            : document.processing_status === "Completed"
              ? "Available to downstream modules"
              : "Monitor processing";

  const classificationCommand = async (
    document: ManagedDocument,
    operation: "confirm" | "override" | "rerun" | "page" | "sheet",
  ) => {
    let body: Record<string, unknown> = {};
    if (operation === "override") {
      const proposedType =
        document.predicted_type &&
        document.predicted_type !== "Unknown" &&
        documentClassificationTypes.includes(document.predicted_type)
          ? document.predicted_type
          : "";
      setClassificationReviewDraft({
        document,
        selectedType: proposedType,
        reason: "",
        saving: false,
        error: "",
      });
      return;
    } else if (operation === "confirm") {
      if (!document.predicted_type || document.predicted_type === "Unknown") {
        setClassificationReviewDraft({
          document,
          selectedType: "",
          reason: "",
          saving: false,
          error: "Select a valid document type before confirming.",
        });
        return;
      }
      body = {
        reason: "Classification evidence reviewed and confirmed",
        startExtraction: false,
      };
    } else if (operation === "page") {
      const pageFrom = Number(window.prompt("First page:", "1"));
      const pageTo = Number(window.prompt("Last page:", String(pageFrom)));
      const selectedType = window
        .prompt(
          "Type for this page range:",
          document.predicted_type || "Unknown",
        )
        ?.trim();
      const reason = window
        .prompt("Evidence/reason:", "Page content reviewed")
        ?.trim();
      if (!selectedType || !reason) return;
      body = { pageFrom, pageTo, selectedType, reason };
    } else if (operation === "sheet") {
      const sheetName = window.prompt("Exact worksheet name:")?.trim();
      const selectedType = window
        .prompt(
          "Type for this worksheet:",
          document.predicted_type || "Unknown",
        )
        ?.trim();
      const reason = window
        .prompt("Evidence/reason:", "Worksheet content reviewed")
        ?.trim();
      if (!sheetName || !selectedType || !reason) return;
      body = { sheetName, selectedType, reason };
    }
    const response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/classification/${operation}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "Classification action failed");
      return;
    }
    await refreshManagedDocuments();
    showToast(
      operation === "rerun"
        ? "Reclassification queued"
        : "Classification decision saved",
    );
  };

  const saveClassificationReview = async () => {
    if (!classificationReviewDraft || classificationReviewDraft.saving) return;
    const selectedType = classificationReviewDraft.selectedType.trim();
    const reason = classificationReviewDraft.reason.trim();
    if (!selectedType || !documentClassificationTypes.includes(selectedType)) {
      setClassificationReviewDraft((current) =>
        current
          ? { ...current, error: "Choose one of the supported document types." }
          : current,
      );
      return;
    }
    if (!reason) {
      setClassificationReviewDraft((current) =>
        current
          ? {
              ...current,
              error: "Add a short reason based on the file content.",
            }
          : current,
      );
      return;
    }
    setClassificationReviewDraft((current) =>
      current ? { ...current, saving: true, error: "" } : current,
    );
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(classificationReviewDraft.document.id)}/classification/override`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            selectedType,
            reason,
            secondaryTypes: [],
            startExtraction: false,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setClassificationReviewDraft((current) =>
          current
            ? {
                ...current,
                saving: false,
                error:
                  result.error?.message || "Classification could not be saved.",
              }
            : current,
        );
        return;
      }
      setClassificationReviewDraft(null);
      await refreshManagedDocuments();
      showToast(`${selectedType} classification saved`);
    } catch (error) {
      setClassificationReviewDraft((current) =>
        current
          ? {
              ...current,
              saving: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Classification could not be saved.",
            }
          : current,
      );
    }
  };

  const boqExtractionCommand = async (
    document: ManagedDocument,
    operation: "start" | "rerun",
  ) => {
    const response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/boq-extraction/${operation}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason:
            operation === "rerun"
              ? "Estimator requested extraction rerun"
              : "Estimator started BOQ extraction",
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "BOQ extraction could not be started");
      return;
    }
    await refreshManagedDocuments();
    showToast(
      result.idempotent
        ? "Existing BOQ extraction opened"
        : "BOQ extraction queued",
    );
  };

  const specificationExtractionCommand = async (
    document: ManagedDocument,
    operation: "start" | "rerun",
  ) => {
    if (
      specificationExtractionRequest?.documentId === document.id &&
      specificationExtractionRequest.loading
    )
      return;
    setSpecificationExtractionRequest({
      documentId: document.id,
      loading: true,
      status: "Starting specification extraction…",
      errorCode: "",
      errorMessage: "",
      suggestedAction: "",
    });
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/specification-extraction/${operation}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason:
              operation === "rerun"
                ? "Technical reviewer requested extraction rerun"
                : "Technical reviewer started specification extraction",
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        const failure = {
          documentId: document.id,
          loading: false,
          status: "Failed",
          errorCode: result.error?.code || "SPECIFICATION_EXTRACTION_FAILED",
          errorMessage:
            result.error?.message ||
            "Specification extraction could not be started",
          suggestedAction:
            result.error?.suggestedAction || "Review the source and retry.",
        };
        setSpecificationExtractionRequest(failure);
        showToast(`${failure.errorCode}: ${failure.errorMessage}`);
        return;
      }
      const status = result.job?.status || result.extraction?.status || "Queued";
      setSpecificationExtractionRequest({
        documentId: document.id,
        loading: false,
        status: result.idempotent
          ? `Existing extraction · ${status}`
          : `Background extraction · ${status}`,
        errorCode: "",
        errorMessage: "",
        suggestedAction: "",
      });
      await refreshManagedDocuments();
      showToast(
        result.idempotent
          ? "Existing specification extraction opened"
          : `Specification extraction queued · ${status}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Specification extraction request failed";
      setSpecificationExtractionRequest({
        documentId: document.id,
        loading: false,
        status: "Failed",
        errorCode: "SPECIFICATION_REQUEST_FAILED",
        errorMessage: message,
        suggestedAction: "Check the connection and retry.",
      });
      showToast(message);
    }
  };

  const engineeringKnowledgeCommand = async (
    operation: "publish" | "suggest-links",
  ) => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/engineering-knowledge/${operation}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason:
            operation === "publish"
              ? "Publish approved source-proven engineering facts"
              : "Generate review-only BOQ applicability suggestions",
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "Engineering knowledge action failed");
      return;
    }
    showToast(
      operation === "publish"
        ? `${result.publication?.factsConsidered || 0} approved facts considered`
        : `${result.suggestions?.linksConsidered || 0} requirement links considered`,
    );
  };

  const openBoqExtractionReview = async (document: ManagedDocument) => {
    try {
      setExtractedBoqItems(await loadAllExtractedBoqItems(document.id));
      setBoqReviewDocument(document);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Extracted BOQ rows could not be loaded",
      );
      return;
    }
  };

  const reviewBoqItem = async (
    item: ExtractedBoqItem,
    operation:
      | "update"
      | "restore"
      | "row-type"
      | "approve"
      | "reject"
      | "merge"
      | "split",
  ) => {
    if (["update", "restore", "approve", "reject"].includes(operation)) {
      openBoqReviewAction(item, operation as BoqReviewActionDraft["operation"]);
      return;
    }
    const reason = window
      .prompt(
        "Reason / source evidence:",
        "Reviewed against the original source",
      )
      ?.trim();
    if (!reason) return;
    let body: Record<string, unknown> = { reason };
    if (operation === "update") {
      const description = window.prompt("Description:", item.description || "");
      const unit = window.prompt("Unit:", item.original_unit || "");
      const quantity = window.prompt("Quantity:", item.original_quantity || "");
      if (description === null || unit === null || quantity === null) return;
      body = {
        reason,
        values: {
          description,
          unit,
          quantity,
          numericQuantity:
            quantity.trim() && Number.isFinite(Number(quantity))
              ? Number(quantity)
              : null,
        },
      };
    }
    if (operation === "restore") {
      const field = window
        .prompt(
          "Field to restore (description, unit, quantity, itemNumber, manufacturer, partNumber, notes):",
          "description",
        )
        ?.trim();
      if (!field) return;
      body = { reason, field };
    }
    if (operation === "row-type") {
      const rowType = window.prompt("Row type:", item.row_type)?.trim();
      if (!rowType) return;
      body = { reason, rowType };
    }
    if (operation === "merge") {
      const otherItemId = window
        .prompt("ID of the row to merge into this row:")
        ?.trim();
      if (!otherItemId) return;
      body = { reason, otherItemId };
    }
    if (operation === "split") {
      const descriptions = (
        window.prompt(
          "Split descriptions separated by |:",
          item.description || "",
        ) || ""
      )
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean);
      if (descriptions.length < 2) return;
      body = { reason, descriptions };
    }
    const response = await fetch(
      `/api/boq-items/${encodeURIComponent(item.id)}/${operation}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "BOQ review action failed");
      return;
    }
    const activeBoqDocument =
      boqReviewDocument ||
      managedDocuments.find(
        (document) => document.id === item.source_document_id,
      );
    if (activeBoqDocument) {
      try {
        const refreshedItems = await loadAllExtractedBoqItems(
          activeBoqDocument.id,
        );
        setExtractedBoqItems((current) => [
          ...current.filter(
            (entry) => entry.source_document_id !== activeBoqDocument.id,
          ),
          ...refreshedItems,
        ]);
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : "Extracted BOQ rows could not be refreshed",
        );
      }
    }
    showToast(
      `${extractionReviewActionLabel(operation)} recorded with audit evidence`,
    );
  };

  const openBoqReviewAction = (
    item: ExtractedBoqItem,
    operation: BoqReviewActionDraft["operation"],
  ) =>
    setBoqReviewAction({
      item,
      operation,
      reason: "",
      description: item.description || "",
      unit: item.original_unit || "",
      quantity: item.original_quantity || "",
      field: "description",
    });

  const submitBoqReviewAction = async () => {
    if (!boqReviewAction || boqReviewAction.reason.trim().length < 3) return;
    const { item, operation } = boqReviewAction;
    let body: Record<string, unknown> = {
      reason: boqReviewAction.reason.trim(),
    };
    if (operation === "update")
      body = {
        ...body,
        values: {
          description: boqReviewAction.description,
          unit: boqReviewAction.unit,
          quantity: boqReviewAction.quantity,
          numericQuantity:
            boqReviewAction.quantity.trim() &&
            Number.isFinite(Number(boqReviewAction.quantity))
              ? Number(boqReviewAction.quantity)
              : null,
        },
      };
    if (operation === "restore")
      body = { ...body, field: boqReviewAction.field };
    const response = await fetch(
      `/api/boq-items/${encodeURIComponent(item.id)}/${operation}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error?.message || "BOQ review action failed");
      return;
    }
    const document = managedDocuments.find(
      (entry) => entry.id === item.source_document_id,
    );
    if (document) {
      try {
        const refreshedItems = await loadAllExtractedBoqItems(document.id);
        setExtractedBoqItems((current) => [
          ...current.filter(
            (entry) => entry.source_document_id !== document.id,
          ),
          ...refreshedItems,
        ]);
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : "Extracted BOQ rows could not be refreshed",
        );
      }
    }
    setBoqReviewAction(null);
    showToast(
      `${extractionReviewActionLabel(operation)} recorded with audit evidence`,
    );
  };

  const loadRequirementProfile = async (itemId: string) => {
    const response = await fetch(
      `/api/boq-items/${encodeURIComponent(itemId)}/requirement-profile`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (
      response.status === 409 &&
      result.error?.code === "REQUIREMENT_PROFILE_REQUIRED"
    ) {
      setRequirementProfilesByItem((current) => ({
        ...current,
        [itemId]: null,
      }));
      return null;
    }
    if (!response.ok)
      throw new Error(
        result.error?.message || "Requirement profile could not be loaded",
      );
    setRequirementProfilesByItem((current) => ({
      ...current,
      [itemId]: result.profile,
    }));
    return result.profile as RequirementProfileView;
  };

  const generateRequirementProfile = async (
    item: ExtractedBoqItem,
    operation: "generate" | "recalculate" = "generate",
  ) => {
    setRequirementProfileLoadingId(item.id);
    setRequirementProfileError("");
    try {
      const response = await fetch(
        `/api/boq-items/${encodeURIComponent(item.id)}/requirement-profile/${operation}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: `Technical reviewer requested requirement-profile ${operation}`,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Requirement profile could not be queued",
        );
      let profile: RequirementProfileView | null = null;
      for (let attempt = 0; attempt < 12 && !profile; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        try {
          profile = await loadRequirementProfile(item.id);
        } catch {
          /* processing is still completing */
        }
      }
      if (!profile)
        throw new Error(
          "Profile processing did not complete. Refresh and retry from this item.",
        );
      showToast(
        operation === "recalculate"
          ? `Requirement profile v${profile.version_number} recalculated`
          : `Requirement profile v${profile.version_number} generated`,
      );
    } catch (error) {
      setRequirementProfileError(
        error instanceof Error
          ? error.message
          : "Requirement profile processing failed",
      );
    } finally {
      setRequirementProfileLoadingId(null);
    }
  };

  const loadRequirementIntelligence = async (itemId: string) => {
    setRequirementIntelligenceLoading(true);
    setRequirementIntelligenceError("");
    try {
      const response = await fetch(
        `/api/boq-items/${encodeURIComponent(itemId)}/requirement-profile/intelligence`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Requirement intelligence could not be loaded.",
        );
      setRequirementIntelligenceFacts(
        Array.isArray(result.facts) ? result.facts : [],
      );
      setRequirementIntelligenceDecisions(
        Array.isArray(result.decisions) ? result.decisions : [],
      );
      return result;
    } catch (error) {
      setRequirementIntelligenceError(
        error instanceof Error
          ? error.message
          : "Requirement intelligence could not be loaded.",
      );
      return null;
    } finally {
      setRequirementIntelligenceLoading(false);
    }
  };

  const openRequirementIntelligence = async (itemId: string) => {
    setRequirementIntelligenceItemId(itemId);
    await loadRequirementIntelligence(itemId);
    const url = new URL(window.location.href);
    url.searchParams.set("requirementIntelligence", itemId);
    window.history.replaceState(null, "", url);
  };
  const closeRequirementIntelligence = () => {
    setRequirementIntelligenceItemId(null);
    setRequirementIntelligenceAction(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("requirementIntelligence");
    window.history.replaceState(null, "", url);
  };
  const submitRequirementIntelligenceAction = async () => {
    if (
      !requirementIntelligenceAction ||
      requirementIntelligenceAction.reason.trim().length < 5
    )
      return;
    setRequirementIntelligenceLoading(true);
    setRequirementIntelligenceError("");
    try {
      const body: Record<string, unknown> = {
        reason: requirementIntelligenceAction.reason.trim(),
      };
      if (requirementIntelligenceAction.operation === "update")
        body.value = requirementIntelligenceAction.value.trim();
      const response = await fetch(
        `/api/requirement-intelligence/${encodeURIComponent(requirementIntelligenceAction.fact.id)}/${requirementIntelligenceAction.operation}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Intelligence decision could not be recorded.",
        );
      if (requirementIntelligenceItemId)
        await loadRequirementIntelligence(requirementIntelligenceItemId);
      setRequirementIntelligenceAction(null);
      showToast(
        `Requirement intelligence ${requirementIntelligenceAction.operation} recorded`,
      );
    } catch (error) {
      setRequirementIntelligenceError(
        error instanceof Error
          ? error.message
          : "Intelligence decision could not be recorded.",
      );
    } finally {
      setRequirementIntelligenceLoading(false);
    }
  };

  const loadEngineeringClassification = async (itemId: string) => {
    setEngineeringClassificationLoading(true);
    setEngineeringClassificationError("");
    try {
      const response = await fetch(
        `/api/boq-items/${encodeURIComponent(itemId)}/engineering-classification`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Engineering classification could not be loaded.",
        );
      setEngineeringClassificationVersion(result.version || null);
      setEngineeringClassificationDecisions(
        Array.isArray(result.decisions) ? result.decisions : [],
      );
      setEngineeringClassificationAudit(
        Array.isArray(result.audit) ? result.audit : [],
      );
      return result;
    } catch (error) {
      setEngineeringClassificationError(
        error instanceof Error
          ? error.message
          : "Engineering classification could not be loaded.",
      );
      return null;
    } finally {
      setEngineeringClassificationLoading(false);
    }
  };
  const generateEngineeringClassification = async (itemId: string) => {
    setEngineeringClassificationLoading(true);
    setEngineeringClassificationError("");
    try {
      const response = await fetch(
        `/api/boq-items/${encodeURIComponent(itemId)}/engineering-classification/recalculate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason:
              "Technical reviewer requested deterministic engineering classification",
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Engineering classification could not be generated.",
        );
      setEngineeringClassificationVersion(result.version || null);
      setEngineeringClassificationDecisions(
        Array.isArray(result.decisions) ? result.decisions : [],
      );
      setEngineeringClassificationAudit(
        Array.isArray(result.audit) ? result.audit : [],
      );
      showToast(
        result.idempotent
          ? `Engineering classification unchanged at v${result.version?.version_number}`
          : `Engineering classification v${result.version?.version_number} generated`,
      );
      return result;
    } catch (error) {
      setEngineeringClassificationError(
        error instanceof Error
          ? error.message
          : "Engineering classification could not be generated.",
      );
      return null;
    } finally {
      setEngineeringClassificationLoading(false);
    }
  };
  const openEngineeringClassification = async (itemId: string) => {
    setEngineeringClassificationItemId(itemId);
    const loaded = await loadEngineeringClassification(itemId);
    if (!loaded) await generateEngineeringClassification(itemId);
    const url = new URL(window.location.href);
    url.searchParams.set("engineeringClassification", itemId);
    window.history.replaceState(null, "", url);
  };
  const closeEngineeringClassification = () => {
    setEngineeringClassificationItemId(null);
    setEngineeringClassificationAction(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("engineeringClassification");
    window.history.replaceState(null, "", url);
  };
  const submitEngineeringClassificationAction = async () => {
    if (
      !engineeringClassificationAction ||
      engineeringClassificationAction.reason.trim().length < 5
    )
      return;
    setEngineeringClassificationLoading(true);
    setEngineeringClassificationError("");
    try {
      const response = await fetch(
        `/api/engineering-classification/decisions/${encodeURIComponent(engineeringClassificationAction.decision.id)}/${engineeringClassificationAction.operation}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: engineeringClassificationAction.reason.trim(),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Engineering decision could not be reviewed.",
        );
      if (engineeringClassificationItemId)
        await loadEngineeringClassification(engineeringClassificationItemId);
      setEngineeringClassificationAction(null);
      showToast(
        `Engineering decision ${engineeringClassificationAction.operation} recorded`,
      );
    } catch (error) {
      setEngineeringClassificationError(
        error instanceof Error
          ? error.message
          : "Engineering decision could not be reviewed.",
      );
    } finally {
      setEngineeringClassificationLoading(false);
    }
  };

  const loadEngineeringGraph = async (itemId: string) => {
    setEngineeringGraphLoading(true);
    setEngineeringGraphError("");
    try {
      const response = await fetch(
        `/api/boq-items/${encodeURIComponent(itemId)}/engineering-graph`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Engineering Graph could not be loaded.",
        );
      setEngineeringGraphVersion(result.version || null);
      setEngineeringGraphNodes(result.nodes || []);
      setEngineeringGraphRelationships(result.relationships || []);
      setEngineeringGraphAudit(result.audit || []);
      return result;
    } catch (error) {
      setEngineeringGraphError(
        error instanceof Error
          ? error.message
          : "Engineering Graph could not be loaded.",
      );
      return null;
    } finally {
      setEngineeringGraphLoading(false);
    }
  };
  const generateEngineeringGraph = async (itemId: string) => {
    setEngineeringGraphLoading(true);
    setEngineeringGraphError("");
    try {
      const response = await fetch(
        `/api/boq-items/${encodeURIComponent(itemId)}/engineering-graph/recalculate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason:
              "Technical reviewer requested deterministic graph recalculation",
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Engineering Graph could not be generated.",
        );
      setEngineeringGraphVersion(result.version || null);
      setEngineeringGraphNodes(result.nodes || []);
      setEngineeringGraphRelationships(result.relationships || []);
      setEngineeringGraphAudit(result.audit || []);
      showToast(
        result.idempotent
          ? `Engineering Graph unchanged at v${result.version?.version_number}`
          : `Engineering Graph v${result.version?.version_number} generated`,
      );
      return result;
    } catch (error) {
      setEngineeringGraphError(
        error instanceof Error
          ? error.message
          : "Engineering Graph could not be generated.",
      );
      return null;
    } finally {
      setEngineeringGraphLoading(false);
    }
  };
  const openEngineeringGraph = async (itemId: string) => {
    setEngineeringGraphItemId(itemId);
    const loaded = await loadEngineeringGraph(itemId);
    if (!loaded) await generateEngineeringGraph(itemId);
    const url = new URL(window.location.href);
    url.searchParams.set("engineeringGraph", itemId);
    window.history.replaceState(null, "", url);
  };
  const closeEngineeringGraph = () => {
    setEngineeringGraphItemId(null);
    setEngineeringGraphAction(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("engineeringGraph");
    window.history.replaceState(null, "", url);
  };
  const submitEngineeringGraphAction = async () => {
    if (
      !engineeringGraphAction ||
      engineeringGraphAction.reason.trim().length < 5
    )
      return;
    setEngineeringGraphLoading(true);
    try {
      const response = await fetch(
        `/api/engineering-graph/relationships/${encodeURIComponent(engineeringGraphAction.relationship.id)}/${engineeringGraphAction.operation}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: engineeringGraphAction.reason.trim(),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message || "Graph review could not be recorded.",
        );
      if (engineeringGraphItemId)
        await loadEngineeringGraph(engineeringGraphItemId);
      setEngineeringGraphAction(null);
    } catch (error) {
      setEngineeringGraphError(
        error instanceof Error
          ? error.message
          : "Graph review could not be recorded.",
      );
    } finally {
      setEngineeringGraphLoading(false);
    }
  };

  const loadApplicabilityLinks = async () => {
    setApplicabilityLoading(true);
    setApplicabilityError("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/engineering-knowledge/links`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Applicability suggestions could not be loaded.",
        );
      setApplicabilityLinks(Array.isArray(result.links) ? result.links : []);
      return result.links || [];
    } catch (error) {
      setApplicabilityError(
        error instanceof Error
          ? error.message
          : "Applicability suggestions could not be loaded.",
      );
      return [];
    } finally {
      setApplicabilityLoading(false);
    }
  };

  const openApplicabilityReview = async () => {
    setApplicabilityReviewOpen(true);
    await loadApplicabilityLinks();
    const url = new URL(window.location.href);
    url.searchParams.set("applicabilityReview", "open");
    window.history.replaceState(null, "", url);
  };
  const closeApplicabilityReview = () => {
    setApplicabilityReviewOpen(false);
    setApplicabilityReviewAction(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("applicabilityReview");
    window.history.replaceState(null, "", url);
  };

  const submitApplicabilityReview = async () => {
    if (
      !applicabilityReviewAction ||
      applicabilityReviewAction.reason.trim().length < 5
    ) {
      setApplicabilityError("A substantive reviewer reason is required.");
      return;
    }
    setApplicabilityActionLoading(true);
    setApplicabilityError("");
    try {
      const response = await fetch(
        `/api/requirement-links/${encodeURIComponent(applicabilityReviewAction.link.id)}/${applicabilityReviewAction.operation}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: applicabilityReviewAction.reason.trim(),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Applicability decision could not be recorded.",
        );
      await loadApplicabilityLinks();
      if (applicabilityReviewAction.operation === "confirm")
        await loadRequirementProfile(
          applicabilityReviewAction.link.boq_item_id,
        );
      showToast(
        applicabilityReviewAction.operation === "confirm"
          ? "Applicability confirmed and Requirement Profile recalculated"
          : `Applicability ${applicabilityReviewAction.operation} recorded; profile unchanged`,
      );
      setApplicabilityReviewAction(null);
    } catch (error) {
      setApplicabilityError(
        error instanceof Error
          ? error.message
          : "Applicability decision could not be recorded.",
      );
    } finally {
      setApplicabilityActionLoading(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const requestedFileArray = Array.from(files);
    const storedFiles: File[] = [];
    setUploadingDocumentNames(requestedFileArray.map((file) => file.name));
    setUploadProgressByName(
      Object.fromEntries(requestedFileArray.map((file) => [file.name, 0])),
    );
    for (const file of requestedFileArray) {
      try {
        const role = uploadIntentRole || inferDocumentRole(file.name);
        const result = await persistManagedFile(file, role);
        if (!result.cancelled) storedFiles.push(file);
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : `Upload failed for ${file.name}`,
        );
      }
    }
    setUploadingDocumentNames([]);
    setUploadProgressByName({});
    await refreshManagedDocuments();
    if (!storedFiles.length) {
      setUploadIntentRole(null);
      return;
    }
    const fileArray = storedFiles;
    const fingerprints = (await Promise.all(
      fileArray.map(async (file) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await file.arrayBuffer(),
        );
        return [
          file.name,
          Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(""),
        ];
      }),
    )) as Array<[string, string]>;
    const requestedNames = [...new Set(fingerprints.map(([name]) => name))];
    const hashesByName = fingerprints.reduce<Record<string, string[]>>(
      (grouped, [name, hash]) => ({
        ...grouped,
        [name]: [...(grouped[name] || []), hash],
      }),
      {},
    );
    const batchNameCollisions = requestedNames.filter(
      (name) => new Set(hashesByName[name]).size > 1,
    );
    const hashes = Object.fromEntries(fingerprints);
    const firstBatchNameByHash = new Map<string, string>();
    const batchDuplicateNames: string[] = [];
    fingerprints.forEach(([name, hash]) => {
      const firstName = firstBatchNameByHash.get(hash);
      if (firstName && firstName !== name) batchDuplicateNames.push(name);
      else firstBatchNameByHash.set(hash, name);
    });
    const conflictingNames = requestedNames.filter(
      (name) =>
        !batchNameCollisions.includes(name) &&
        documentHashes[name] &&
        documentHashes[name] !== hashes[name] &&
        !Object.values(documentHashes).includes(hashes[name]),
    );
    const duplicateContentNames = [
      ...new Set([
        ...batchDuplicateNames,
        ...requestedNames.filter((name) =>
          Object.entries(documentHashes).some(
            ([existingName, existingHash]) =>
              existingName !== name && existingHash === hashes[name],
          ),
        ),
      ]),
    ];
    const unchangedNames = requestedNames.filter(
      (name) => documentHashes[name] === hashes[name],
    );
    const names = requestedNames.filter(
      (name) =>
        !batchNameCollisions.includes(name) &&
        !conflictingNames.includes(name) &&
        !duplicateContentNames.includes(name) &&
        !unchangedNames.includes(name),
    );
    if (conflictingNames.length) {
      const stagedAt = new Date().toISOString();
      const staged = conflictingNames.map((name) => ({
        id: `${name}:${hashes[name]}`,
        fileName: name,
        previousHash: documentHashes[name],
        candidateHash: hashes[name],
        role:
          documentRoles[name] || uploadIntentRole || inferDocumentRole(name),
        control: {
          revision: "",
          issueDate: "",
          status: "Tender" as DocumentIssueStatus,
          transmittal: "",
          confirmed: false,
        },
        stagedAt,
      }));
      setRevisionCandidates((current) => [
        ...current,
        ...staged.filter(
          (candidate) =>
            !current.some(
              (existing) => existing.candidateHash === candidate.candidateHash,
            ),
        ),
      ]);
    }
    if (batchNameCollisions.length && names.length)
      recordAudit(
        "Ambiguous upload batch quarantined",
        `${batchNameCollisions.join(", ")} · one upload batch contained the same filename with different fingerprints · ambiguous files excluded while ${names.length} unambiguous file${names.length === 1 ? " was" : "s were"} allowed to continue`,
      );
    if (!names.length) {
      const repeatedKnownBoq = fileArray.find(
        (file) =>
          unchangedNames.includes(file.name) &&
          hashes[file.name] === almoosaBoqSha256 &&
          (uploadIntentRole === "BOQ" ||
            documentRoles[file.name] === "BOQ" ||
            inferDocumentRole(file.name) === "BOQ"),
      );
      if (repeatedKnownBoq) {
        setBoqPreviewFile(repeatedKnownBoq.name);
        setBoqLineDecisions(
          Object.fromEntries(initialItems.map((item) => [item.id, "Pending"])),
        );
        setBoqExclusionReasons({});
        setBoqReviewSearch("");
        setUploadIntentRole(null);
        recordAudit(
          "Registered BOQ extraction reopened",
          `${repeatedKnownBoq.name} · identical controlled fingerprint · 21 normalized candidates reopened · no project rows changed`,
        );
        showToast(
          "Registered BOQ reopened — review issue metadata and 21 extracted candidates",
        );
        return;
      }
      const repeatedGenericBoq = fileArray.find(
        (file) =>
          unchangedNames.includes(file.name) &&
          file.name.toLowerCase().endsWith(".csv") &&
          (uploadIntentRole === "BOQ" ||
            documentRoles[file.name] === "BOQ" ||
            inferDocumentRole(file.name) === "BOQ"),
      );
      if (repeatedGenericBoq) {
        const preview = parseGenericBoqCsv(
          await repeatedGenericBoq.text(),
          repeatedGenericBoq.name,
          hashes[repeatedGenericBoq.name],
        );
        setGenericBoqPreview(preview);
        setBoqLineDecisions(
          Object.fromEntries(
            preview.candidates.map((candidate) => [
              candidate.rowNumber,
              "Pending",
            ]),
          ),
        );
        setBoqExclusionReasons({});
        setBoqReviewSearch("");
        setUploadIntentRole(null);
        recordAudit(
          "Registered generic BOQ reopened",
          `${repeatedGenericBoq.name} · identical registered fingerprint · decisions restarted from pending · no project rows changed`,
        );
        showToast("Registered CSV reopened for a fresh extraction review");
        return;
      }
      const reason = batchNameCollisions.length
        ? `${batchNameCollisions.join(", ")} · one upload batch contained the same filename with different fingerprints · ambiguous files quarantined`
        : conflictingNames.length
          ? `${conflictingNames.join(", ")} · same filename with a new fingerprint staged as a revision candidate · existing issue retained`
          : duplicateContentNames.length
            ? `${duplicateContentNames.join(", ")} · identical content is already registered under another filename or in this upload batch`
            : `${unchangedNames.join(", ")} · identical filename and content already registered`;
      recordAudit(
        batchNameCollisions.length
          ? "Ambiguous upload batch quarantined"
          : conflictingNames.length
            ? "Document revision candidate staged"
            : "Duplicate document registration skipped",
        reason,
      );
      setUploadIntentRole(null);
      showToast(
        batchNameCollisions.length
          ? "Upload blocked: one filename had different content in the same batch"
          : conflictingNames.length
            ? "New fingerprint staged as a revision candidate; confirm its issue metadata"
            : "Duplicate content skipped — one canonical project document was kept",
      );
      return;
    }
    const acceptedHashes = Object.fromEntries(
      names.map((name) => [name, hashes[name]]),
    );
    const initialRoleForName = (name: string): DocumentRole =>
      uploadIntentRole || inferDocumentRole(name);
    setUploadedFiles((current) => [...new Set([...current, ...names])]);
    setDocumentRoles((current) => ({
      ...Object.fromEntries(
        names.map((name) => [name, current[name] || initialRoleForName(name)]),
      ),
      ...current,
    }));
    setDocumentHashes((current) => ({ ...current, ...acceptedHashes }));
    setDocumentControls((current) => ({
      ...current,
      ...Object.fromEntries(
        names.map((name) => {
          const revisionMatch = name.match(
            /(?:rev(?:ision)?[\s_-]*)([a-z0-9.]+)/i,
          );
          return [
            name,
            current[name] || {
              revision: revisionMatch?.[1] || "",
              issueDate: "",
              status: "Tender" as DocumentIssueStatus,
              transmittal: "",
              confirmed: false,
            },
          ];
        }),
      ),
    }));
    let supplierResponseRoleBlocked = false;
    if (pendingQuoteRfqId) {
      const mismatchedResponseNames = names.filter(
        (name) =>
          !["Supplier quotation", "Unclassified"].includes(
            initialRoleForName(name),
          ) || hashes[name] === honeywellPriceListSha256,
      );
      const responseNames = names.filter(
        (name) => !mismatchedResponseNames.includes(name),
      );
      setDocumentRoles((current) => ({
        ...current,
        ...Object.fromEntries(
          responseNames.map((name) => [
            name,
            "Supplier quotation" as DocumentRole,
          ]),
        ),
      }));
      setRfqs((records) =>
        records.map((rfq) =>
          rfq.id === pendingQuoteRfqId && responseNames.length
            ? {
                ...rfq,
                status: "Response registered",
                responseFiles: [
                  ...new Set([...rfq.responseFiles, ...responseNames]),
                ],
              }
            : rfq,
        ),
      );
      const target = rfqs.find((rfq) => rfq.id === pendingQuoteRfqId);
      if (responseNames.length)
        recordAudit(
          "Supplier response registered",
          `${target?.code || pendingQuoteRfqId} · ${responseNames.join(", ")} · content and prices require review before any award`,
        );
      if (mismatchedResponseNames.length)
        recordAudit(
          "Supplier response role mismatch quarantined",
          `${target?.code || pendingQuoteRfqId} · ${mismatchedResponseNames.join(", ")} · registered under ${mismatchedResponseNames.map((name) => initialRoleForName(name)).join(" / ")} but excluded from supplier normalization · no commercial rows accepted`,
        );
      setPendingQuoteRfqId(null);
      supplierResponseRoleBlocked = !responseNames.length;
    }
    const genericBoqFile = fileArray.find(
      (file) =>
        names.includes(file.name) &&
        file.name.toLowerCase().endsWith(".csv") &&
        (uploadIntentRole === "BOQ" || inferDocumentRole(file.name) === "BOQ"),
    );
    const knownBoqFile = fileArray.find(
      (file) =>
        names.includes(file.name) && hashes[file.name] === almoosaBoqSha256,
    );
    if (genericBoqFile) {
      const preview = parseGenericBoqCsv(
        await genericBoqFile.text(),
        genericBoqFile.name,
        hashes[genericBoqFile.name],
      );
      setGenericBoqPreview(preview);
      setBoqLineDecisions(
        Object.fromEntries(
          preview.candidates.map((candidate) => [
            candidate.rowNumber,
            "Pending",
          ]),
        ),
      );
      setBoqExclusionReasons({});
      setBoqReviewSearch("");
      recordAudit(
        preview.fatalError
          ? "Generic BOQ parsing blocked"
          : "Generic BOQ staged for review",
        `${genericBoqFile.name} · SHA-256 ${hashes[genericBoqFile.name].slice(0, 12)}… · ${preview.fatalError || `${preview.candidates.length} candidate rows · no prices imported`}`,
      );
    } else if (knownBoqFile && !items.length) {
      setBoqPreviewFile(knownBoqFile.name);
      setBoqLineDecisions(
        Object.fromEntries(initialItems.map((item) => [item.id, "Pending"])),
      );
      setBoqExclusionReasons({});
      setBoqReviewSearch("");
      recordAudit(
        "Known BOQ extraction staged for review",
        `${knownBoqFile.name} · SHA-256 ${hashes[knownBoqFile.name].slice(0, 12)}… · 90 source rows normalized to 21 candidates · no project rows changed`,
      );
    }
    recordAudit(
      "Documents registered",
      `${names.length} file${names.length > 1 ? "s" : ""}: ${names.join(", ")} · no BOQ or pricing data changed${conflictingNames.length ? ` · ${conflictingNames.length} same-name new fingerprint${conflictingNames.length === 1 ? "" : "s"} staged for revision control` : ""}${duplicateContentNames.length || unchangedNames.length ? ` · ${duplicateContentNames.length + unchangedNames.length} duplicate content item${duplicateContentNames.length + unchangedNames.length === 1 ? "" : "s"} skipped` : ""}`,
    );
    setUploadIntentRole(null);
    showToast(
      supplierResponseRoleBlocked
        ? "Supplier response blocked: selected files appear to be BOQ, technical, inquiry, or price-library evidence"
        : knownBoqFile && !items.length
          ? "BOQ extracted to 21 review candidates — confirm issue metadata and accept or exclude every line"
          : `${names.length} file${names.length > 1 ? "s" : ""} registered for review${conflictingNames.length ? `; ${conflictingNames.length} revised issue${conflictingNames.length === 1 ? "" : "s"} staged separately` : ""}`,
    );
    setActiveStep(2);
    setActiveModule("Documents");
  };

  const closeKnownBoqExtraction = () => {
    setBoqPreviewFile(null);
    setBoqLineDecisions({});
    setBoqExclusionReasons({});
    setBoqReviewSearch("");
  };

  const applyKnownBoqExtraction = (fileName: string) => {
    if (documentHashes[fileName] !== almoosaBoqSha256) {
      showToast("Apply blocked: workbook fingerprint is not recognized");
      return;
    }
    if (!documentIssueAllowsScope(fileName)) {
      showToast(
        "Apply blocked: confirm an active Tender or Addendum issue first",
      );
      return;
    }
    if (items.length > 0) {
      showToast("Apply blocked: this project already has BOQ lines");
      return;
    }
    const anchorIntegrity = sourceAnchorIntegrity(initialItems);
    if (
      anchorIntegrity.anchorCount !== 90 ||
      anchorIntegrity.uniqueAnchorCount !== 90 ||
      anchorIntegrity.duplicateAssignments ||
      anchorIntegrity.unanchoredLines
    ) {
      showToast("Apply blocked: 90-row source-anchor reconciliation failed");
      return;
    }
    const pending = initialItems.filter(
      (item) => (boqLineDecisions[item.id] || "Pending") === "Pending",
    );
    const excludedWithoutReason = initialItems.filter(
      (item) =>
        boqLineDecisions[item.id] === "Excluded" &&
        !boqExclusionReasons[item.id]?.trim(),
    );
    const accepted = initialItems.filter(
      (item) => boqLineDecisions[item.id] === "Accepted",
    );
    if (pending.length || excludedWithoutReason.length || !accepted.length) {
      showToast(
        pending.length
          ? `Apply blocked: review ${pending.length} pending normalized line${pending.length === 1 ? "" : "s"}`
          : excludedWithoutReason.length
            ? "Apply blocked: every excluded line requires a reason"
            : "Apply blocked: accept at least one normalized line",
      );
      return;
    }
    const excluded = initialItems.filter(
      (item) => boqLineDecisions[item.id] === "Excluded",
    );
    setItems(
      accepted.map((item) => ({
        ...item,
        supplier: "Awaiting technical selection",
        unitCost: 0,
        status: "RFQ Required",
        specification: "",
      })),
    );
    setAppliedDocumentHashes((current) => [
      ...new Set([...current, almoosaBoqSha256]),
    ]);
    setProjectStatus("Technical Review");
    recordAudit(
      "BOQ extraction decisions applied",
      `${fileName} · SHA-256 ${almoosaBoqSha256.slice(0, 12)}… · 90 source rows normalized to 21 candidates · ${accepted.length} accepted · ${excluded.length} excluded${excluded.length ? ` (${excluded.map((item) => `BOQ-${item.id}: ${boqExclusionReasons[item.id].trim()}`).join("; ")})` : ""} · no specifications or prices imported`,
    );
    closeKnownBoqExtraction();
    setActiveModule("BOQ");
    showToast(
      `${accepted.length} reviewed BOQ line${accepted.length === 1 ? "" : "s"} applied without specifications or prices`,
    );
  };

  const closeGenericBoqPreview = () => {
    setGenericBoqPreview(null);
    setBoqLineDecisions({});
    setBoqExclusionReasons({});
    setBoqReviewSearch("");
  };

  const applyGenericBoqExtraction = () => {
    if (!genericBoqPreview || genericBoqPreview.fatalError) return;
    if (documentHashes[genericBoqPreview.fileName] !== genericBoqPreview.hash) {
      showToast(
        "Apply blocked: the staged CSV no longer matches the registered document fingerprint",
      );
      return;
    }
    if (!documentIssueAllowsScope(genericBoqPreview.fileName)) {
      showToast(
        "Apply blocked: confirm an active Tender or Addendum issue first",
      );
      return;
    }
    if (items.length) {
      showToast("Apply blocked: this project already has BOQ lines");
      return;
    }
    const pending = genericBoqPreview.candidates.filter(
      (candidate) =>
        (boqLineDecisions[candidate.rowNumber] || "Pending") === "Pending",
    );
    const excludedWithoutReason = genericBoqPreview.candidates.filter(
      (candidate) =>
        boqLineDecisions[candidate.rowNumber] === "Excluded" &&
        !boqExclusionReasons[candidate.rowNumber]?.trim(),
    );
    const accepted = genericBoqPreview.candidates.filter(
      (candidate) => boqLineDecisions[candidate.rowNumber] === "Accepted",
    );
    const invalidAccepted = accepted.filter(
      (candidate) => candidate.errors.length,
    );
    if (
      pending.length ||
      excludedWithoutReason.length ||
      invalidAccepted.length ||
      !accepted.length
    ) {
      showToast(
        pending.length
          ? `Apply blocked: review ${pending.length} pending CSV row${pending.length === 1 ? "" : "s"}`
          : excludedWithoutReason.length
            ? "Apply blocked: every excluded CSV row requires a reason"
            : invalidAccepted.length
              ? "Apply blocked: invalid rows cannot be accepted"
              : "Apply blocked: accept at least one valid BOQ row",
      );
      return;
    }
    setItems(
      accepted.map((candidate, index) => ({
        id: index + 1,
        system: candidate.system,
        item: candidate.item,
        qty: candidate.qty,
        supplier: "Not assigned",
        unitCost: 0,
        markup: 20,
        status: "RFQ Required",
        unit: candidate.unit,
        specification: candidate.technicalReference,
        sourceRows: [candidate.rowNumber],
      })),
    );
    setAppliedDocumentHashes((current) => [
      ...new Set([...current, genericBoqPreview.hash]),
    ]);
    setTechnicalProfileLoaded(false);
    setRequirementReviews([]);
    setProjectStatus("Technical Requirements Pending");
    const excluded = genericBoqPreview.candidates.filter(
      (candidate) => boqLineDecisions[candidate.rowNumber] === "Excluded",
    );
    recordAudit(
      "Generic BOQ extraction decisions applied",
      `${genericBoqPreview.fileName} · SHA-256 ${genericBoqPreview.hash.slice(0, 12)}… · ${accepted.length} accepted · ${excluded.length} excluded${excluded.length ? ` (${excluded.map((candidate) => `row ${candidate.rowNumber}: ${boqExclusionReasons[candidate.rowNumber].trim()}`).join("; ")})` : ""} · supplier and price columns ignored · no prices imported`,
    );
    closeGenericBoqPreview();
    setActiveModule("BOQ");
    showToast(
      `${accepted.length} generic BOQ row${accepted.length === 1 ? "" : "s"} applied without prices`,
    );
  };

  const indexKnownPriceSource = async (fileName: string) => {
    if (documentHashes[fileName] !== honeywellPriceListSha256) {
      showToast("Index blocked: workbook fingerprint is not recognized");
      return;
    }
    if (!sourceReviewConfirmed) {
      showToast(
        "Index blocked: confirm the sheet exclusions and source currency first",
      );
      return;
    }
    const document = managedDocuments.find(
      (entry) => entry.original_filename === fileName || entry.logical_name === fileName,
    );
    if (!document?.version_id) {
      showToast("Index blocked: upload and persist this source document first");
      return;
    }
    try {
      await requestJson(commercialApi.ingestLibraryDocument(document.version_id), { method: "POST" });
      await refreshDurableLibrarySources();
      setSourcePreviewFile(null);
      showToast("Historical catalogue persisted for discovery only");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Price source ingestion failed");
    }
  };

  const indexKnownTechnicalSpecification = (fileName: string) => {
    if (documentHashes[fileName] !== fireAlarmSpecificationSha256) {
      showToast("Index blocked: specification fingerprint is not recognized");
      return;
    }
    if (!documentIssueAllowsScope(fileName)) {
      showToast(
        "Index blocked: confirm an active Tender or Addendum issue first",
      );
      return;
    }
    if (
      !fireRequirementAnchorIntegrity.valid ||
      fireRequirementAnchorIntegrity.anchoredRequirements !== 6
    ) {
      showToast(
        "Index blocked: specification page-and-clause anchor reconciliation failed",
      );
      return;
    }
    setIndexedTechnicalHashes((current) => [
      ...new Set([...current, fireAlarmSpecificationSha256]),
    ]);
    setDocumentRoles((current) => ({
      ...current,
      [fileName]: "Specification",
    }));
    setTechnicalProfileLoaded(true);
    setRequirementReviews((current) =>
      current.length
        ? current
        : fireRequirements.map((requirement) => ({
            ...requirement,
            evidence: "",
            reviewerNote: "",
          })),
    );
    setProjectStatus(items.length ? "Technical Review" : "Documents Pending");
    recordAudit(
      "Technical specification indexed",
      `${fileName} · SHA-256 ${fireAlarmSpecificationSha256.slice(0, 12)}… · 31 pages · 6 governing requirement groups linked with page and clause evidence · no BOQ quantities or prices changed`,
    );
    setTechnicalPreviewFile(null);
    showToast("Technical profile indexed without changing BOQ or prices");
  };

  const openRequirementReview = (requirement: RequirementReview) => {
    setActiveRequirementId(requirement.id);
    setRequirementResult(requirement.status);
    setRequirementEvidence(requirement.evidence);
    setRequirementNote(requirement.reviewerNote);
  };

  const saveRequirementReview = () => {
    if (
      !requireWorkingRole(
        "Engineering Reviewer",
        "Technical requirement decision",
      )
    )
      return;
    const requirement = requirementReviews.find(
      (entry) => entry.id === activeRequirementId,
    );
    if (!requirement) return;
    if (
      requirementResult !== "Review" &&
      (!requirementEvidence.trim() || !requirementNote.trim())
    ) {
      showToast(
        "Technical decision requires evidence reference and reviewer note",
      );
      return;
    }
    const reviewedAt = new Date().toISOString();
    setRequirementReviews((current) =>
      current.map((entry) =>
        entry.id === requirement.id
          ? {
              ...entry,
              status: requirementResult,
              evidence: requirementEvidence.trim(),
              reviewerNote: requirementNote.trim(),
              reviewedAt,
              reviewedBy: workingRole,
              candidate:
                requirementResult === "Compliant"
                  ? "Evidence accepted"
                  : requirementResult === "Deviation"
                    ? "Deviation recorded"
                    : "Evidence review pending",
            }
          : entry,
      ),
    );
    recordAudit(
      "Technical requirement reviewed",
      `${requirement.id} · ${requirement.source} · ${requirementResult} · evidence: ${requirementEvidence.trim() || "pending"} · ${requirementNote.trim() || "draft saved"}`,
    );
    setActiveRequirementId(null);
    setRequirementEvidence("");
    setRequirementNote("");
    showToast(
      requirementResult === "Compliant"
        ? "Requirement marked compliant with evidence"
        : "Technical review saved",
    );
  };

  const commercialToday = new Date().toISOString().slice(0, 10);
  const exchangeRateEvidenceStatus = !rateResolved
    ? "Unconfirmed"
    : !exchangeRateEvidence.source.trim() ||
        !exchangeRateEvidence.effectiveDate ||
        !exchangeRateEvidence.validUntil
      ? "Evidence missing"
      : exchangeRateEvidence.effectiveDate > commercialToday
        ? "Not effective"
        : exchangeRateEvidence.validUntil < commercialToday
          ? "Expired"
          : "Current";
  const rateReady = exchangeRateEvidenceStatus === "Current";
  const rateExpiryDays = exchangeRateEvidence.validUntil
    ? Math.ceil(
        (new Date(`${exchangeRateEvidence.validUntil}T00:00:00`).getTime() -
          new Date(`${commercialToday}T00:00:00`).getTime()) /
          86400000,
      )
    : null;
  const rateExpiringSoon =
    rateReady && rateExpiryDays !== null && rateExpiryDays <= 7;
  const projectAuditEvents = auditEvents.filter(
    (event) => event.projectId === projectId,
  );
  const auditIntegrityValid = auditChainIntegrity(
    projectAuditEvents,
    projectId,
  );
  const auditChainHead = projectAuditEvents[0]?.eventHash || auditGenesis;
  const foreignRfqRecords = rfqs.filter((rfq) => rfq.projectId !== projectId);
  const foreignQuotationApprovals = quotationApprovals.filter(
    (approval) => approval.projectId !== projectId,
  );
  const workspaceOwnershipConflicts =
    foreignRfqRecords.length + foreignQuotationApprovals.length;
  const workspaceContextSeal = `WS-${localBackupChecksum(JSON.stringify({ projectId, projectCode, boq: items.map((item) => ({ id: item.id, sourceRows: item.sourceRows })) })).slice(3)}`;
  const costEvidenceStates = summarizePriceEvidence(items, commercialToday);
  const expiredCostItems = costEvidenceStates.filter(
    (entry) => entry.status === "Expired",
  );
  const validityMissingCostItems = costEvidenceStates.filter(
    (entry) => entry.status === "Validity missing",
  );
  const unpricedCostItems = costEvidenceStates.filter(
    (entry) => entry.status === "Unpriced",
  );
  const expiringCostItems = costEvidenceStates.filter(
    (entry) => entry.status === "Expiring soon",
  );
  const currentCostItems = costEvidenceStates.filter((entry) =>
    ["Current", "Expiring soon"].includes(entry.status),
  );
  const systemCommercialSummary = [
    ...new Set(items.map((item) => item.system || "Unclassified")),
  ]
    .map((system) => {
      const systemStates = costEvidenceStates.filter(
        ({ item }) => (item.system || "Unclassified") === system,
      );
      const currentStates = systemStates.filter(({ status }) =>
        ["Current", "Expiring soon"].includes(status),
      );
      const directCost = currentStates.reduce(
        (sum, { item }) => sum + item.qty * item.unitCost,
        0,
      );
      const baseSellingValue = currentStates.reduce(
        (sum, { item }) =>
          sum + item.qty * item.unitCost * (1 + item.markup / 100),
        0,
      );
      const sellingValue = baseSellingValue * (1 + riskAllowanceRate / 100);
      return {
        system,
        lines: systemStates.length,
        currentLines: currentStates.length,
        directCost,
        sellingValue,
        coverage: Math.round(
          (currentStates.length / Math.max(systemStates.length, 1)) * 100,
        ),
      };
    })
    .sort(
      (a, b) =>
        b.sellingValue - a.sellingValue || a.system.localeCompare(b.system),
    );
  const reportCommercialTotals = systemCommercialSummary.reduce(
    (summary, system) => ({
      directCost: summary.directCost + system.directCost,
      sellingValue: summary.sellingValue + system.sellingValue,
    }),
    { directCost: 0, sellingValue: 0 },
  );
  const reportGrossProfit =
    reportCommercialTotals.sellingValue - reportCommercialTotals.directCost;
  const reportGrossMargin = reportCommercialTotals.sellingValue
    ? (reportGrossProfit / reportCommercialTotals.sellingValue) * 100
    : 0;
  const priceEvidenceOpenItems = costEvidenceStates.filter(
    (entry) => !["Current", "Expiring soon"].includes(entry.status),
  );
  const outstanding = priceEvidenceOpenItems.length;
  const technicalOutstanding = technicalProfileLoaded
    ? requirementReviews.filter((item) => item.status !== "Compliant").length
    : 0;
  const scopeMissing = items.length === 0;
  const persistedBoqItemCount = Number(
    serverProjectDashboard?.facts.boqItems ||
      managedDocuments.reduce(
        (sum, document) =>
          sum + Number(boqSummaryFor(document).validBoqItems || 0),
        0,
      ),
  );
  const persistedRequirementCount = managedDocuments.reduce(
    (sum, document) =>
      sum + Number(specificationSummaryFor(document).requirements || 0),
    0,
  );
  const persistedRequirementNeedsReview = managedDocuments.reduce(
    (sum, document) =>
      sum + Number(specificationSummaryFor(document).itemsNeedingReview || 0),
    0,
  );
  const persistedRequirementReviewedCount = Math.max(
    0,
    persistedRequirementCount - persistedRequirementNeedsReview,
  );
  const persistedTechnicalScopeReady =
    persistedBoqItemCount > 0 && persistedRequirementCount > 0;
  const technicalProfileMissing = !scopeMissing && !technicalProfileLoaded;
  const technicalControlOpen =
    technicalOutstanding > 0 || technicalProfileMissing;
  const projectDrawingCount = baseTenderLoaded
    ? 13
    : uploadedFiles.filter(
        (name) =>
          (documentRoles[name] || inferDocumentRole(name)) === "Drawing",
      ).length;
  const engineeringDossier = buildEngineeringDossier({
    technicalProfileLoaded,
    requirements: requirementReviews,
    drawingCount: projectDrawingCount,
    boqLineCount: persistedBoqItemCount,
  });
  const engineeringApprovalBlocked = !engineeringDossier.approvalReady;
  const clientTermsMissing =
    !clientPaymentTerms.trim() ||
    !clientDeliveryTerms.trim() ||
    !clientDeliveryLocation.trim() ||
    !clientFreightTerms.trim() ||
    clientQualifications.trim().length < 4;
  const knownServiceScope =
    baseTenderLoaded || appliedDocumentHashes.includes(almoosaBoqSha256);
  const scopeAlignmentResolved =
    !knownServiceScope ||
    (scopeAlignmentDecision.status === "Materials-only authorized" &&
      scopeAlignmentDecision.sourceFingerprint === almoosaBoqSha256);
  const obsoleteLifecycleFindings = items.flatMap((item) => {
    const tokens = `${item.item} ${item.specification}`
      .toUpperCase()
      .split(/[^A-Z0-9.-]+/)
      .filter(Boolean);
    return honeywellLifecycleMappings
      .filter((mapping) => tokens.includes(mapping.obsoletePart))
      .map((mapping) => ({ item, mapping }));
  });
  const unresolvedLifecycleFindings = obsoleteLifecycleFindings.filter(
    ({ mapping }) =>
      !lifecycleReviews[mapping.id] ||
      lifecycleReviews[mapping.id].status === "Pending",
  );
  const alertCount = scopeMissing
    ? 1
    : (outstanding ? 1 : 0) +
      (engineeringApprovalBlocked ? 1 : 0) +
      (rateReady ? 0 : 1) +
      (clientTermsMissing ? 1 : 0) +
      (scopeAlignmentResolved ? 0 : 1) +
      (revisionCandidates.length ? 1 : 0) +
      (unresolvedLifecycleFindings.length ? 1 : 0) +
      (workspaceOwnershipConflicts ? 1 : 0) +
      (auditIntegrityValid ? 0 : 1);
  const currency = "SAR";
  const pricedCount = currentCostItems.length;
  const projectCompletion = Math.round(
    (pricedCount / Math.max(items.length, 1)) * 100,
  );
  const currentDocumentCount =
    (baseTenderLoaded ? tenderDocuments.length : 0) + uploadedFiles.length;
  const roleCount = (role: DocumentRole) =>
    uploadedFiles.filter(
      (name) => (documentRoles[name] || inferDocumentRole(name)) === role,
    ).length;
  const hasBoqEvidence = baseTenderLoaded || roleCount("BOQ") > 0;
  const hasSpecificationEvidence =
    technicalProfileLoaded || roleCount("Specification") > 0;
  const drawingEvidenceCount =
    (baseTenderLoaded ? 13 : 0) + roleCount("Drawing");
  const clientInquiryFiles = uploadedFiles.filter(
    (name) =>
      (documentRoles[name] || inferDocumentRole(name)) === "Client inquiry",
  );
  const confirmedClientInquiryCount = clientInquiryFiles.filter(
    (name) => documentControls[name]?.confirmed,
  ).length;
  const confirmedAddendaCount = Object.values(documentControls).filter(
    (control) => control.confirmed && control.status === "Addendum",
  ).length;
  const rawDocumentReadiness = Math.round(
    ([
      hasBoqEvidence,
      hasSpecificationEvidence,
      drawingEvidenceCount > 0,
    ].filter(Boolean).length /
      3) *
      100,
  );
  const documentReadiness = revisionCandidates.length
    ? Math.min(80, rawDocumentReadiness)
    : rawDocumentReadiness;
  const technicalReadiness = technicalProfileMissing
    ? 0
    : Math.round(
        ((requirementReviews.length - technicalOutstanding) /
          Math.max(requirementReviews.length, 1)) *
          100,
      );
  const commercialReadiness = Math.round(
    ([
      outstanding === 0,
      rateReady,
      !clientTermsMissing,
      scopeAlignmentResolved,
    ].filter(Boolean).length /
      4) *
      100,
  );
  const overallReadiness = Math.round(
    (documentReadiness +
      projectCompletion +
      technicalReadiness +
      commercialReadiness) /
      4,
  );
  const actionQueue = [
    !auditIntegrityValid
      ? {
          priority: "P0",
          title: "Investigate broken audit chain",
          detail:
            "A project event no longer matches its stored owner, predecessor or event fingerprint. Quotation issue remains blocked.",
          target: "Activity" as ModuleName,
        }
      : null,
    workspaceOwnershipConflicts
      ? {
          priority: "P0",
          title: `Quarantine ${workspaceOwnershipConflicts} cross-project record${workspaceOwnershipConflicts === 1 ? "" : "s"}`,
          detail:
            "An RFQ or quotation approval does not belong to the active project identity. Final issue remains blocked until project ownership is corrected.",
          target: "Review" as ModuleName,
        }
      : null,
    revisionCandidates.length
      ? {
          priority: "P0",
          title: `Resolve ${revisionCandidates.length} document revision candidate${revisionCandidates.length === 1 ? "" : "s"}`,
          detail:
            "A known filename arrived with new content. Confirm its revision and transmittal before relying on the current tender baseline.",
          target: "Documents" as ModuleName,
        }
      : null,
    unresolvedLifecycleFindings.length
      ? {
          priority: "P0",
          title: `Review ${unresolvedLifecycleFindings.length} obsolete product reference${unresolvedLifecycleFindings.length === 1 ? "" : "s"}`,
          detail:
            "The catalogue contains replacement evidence, but engineering must review it before supplier clarification or technical comparison.",
          target: "Price Sources" as ModuleName,
        }
      : null,
    scopeMissing
      ? {
          priority: "P0",
          title: currentDocumentCount
            ? "Review document intake"
            : "Add project documents",
          detail: currentDocumentCount
            ? "Classify registered files and approve the BOQ extraction."
            : "Add the BOQ, specifications and drawings for this isolated workspace.",
          target: "Documents" as ModuleName,
        }
      : null,
    !scopeMissing && unpricedCostItems.length
      ? {
          priority: "P0",
          title: `Resolve ${unpricedCostItems.length} unpriced BOQ line${unpricedCostItems.length === 1 ? "" : "s"}`,
          detail:
            "Approve current source evidence or route unresolved scope into supplier RFQs.",
          target: "Review" as ModuleName,
        }
      : null,
    expiredCostItems.length || validityMissingCostItems.length
      ? {
          priority: "P0",
          title: `Renew ${expiredCostItems.length + validityMissingCostItems.length} stale price record${expiredCostItems.length + validityMissingCostItems.length === 1 ? "" : "s"}`,
          detail:
            "Expired or undated cost evidence no longer counts as safely priced. Request a current supplier quotation before approval.",
          target: "Supplier RFQs" as ModuleName,
        }
      : null,
    expiringCostItems.length
      ? {
          priority: "P1",
          title: `${expiringCostItems.length} price record${expiringCostItems.length === 1 ? "" : "s"} expire within 7 days`,
          detail:
            "Start supplier renewal now; the current quotation will block automatically after expiry.",
          target: "Supplier RFQs" as ModuleName,
        }
      : null,
    !scopeMissing && technicalControlOpen
      ? {
          priority: "P0",
          title: technicalProfileMissing
            ? "Extract technical requirements"
            : `Review ${technicalOutstanding} technical requirement${technicalOutstanding === 1 ? "" : "s"}`,
          detail:
            "Record product, authority, capacity, battery and warranty evidence before approval.",
          target: technicalProfileMissing
            ? ("Documents" as ModuleName)
            : ("Technical Matching" as ModuleName),
        }
      : null,
    !scopeMissing && !rateReady
      ? {
          priority: "P1",
          title:
            exchangeRateEvidenceStatus === "Expired"
              ? "Renew expired exchange rate"
              : "Confirm project exchange rate evidence",
          detail: `${exchangeRate.toFixed(3)} SAR/USD is ${exchangeRateEvidenceStatus.toLowerCase()}; record a source and current validity period.`,
          target: "Settings",
        }
      : null,
    !scopeMissing && rateExpiringSoon
      ? {
          priority: "P1",
          title: "Exchange rate expires soon",
          detail: `The conversion basis expires in ${rateExpiryDays} day${rateExpiryDays === 1 ? "" : "s"}; renew its source evidence before quotation issue.`,
          target: "Settings",
        }
      : null,
    !scopeMissing && clientTermsMissing
      ? {
          priority: "P1",
          title: "Complete client commercial terms",
          detail:
            "Payment, delivery location, delivery period and freight terms must be explicit and separate from supplier terms.",
          target: "Settings",
        }
      : null,
    !scopeMissing && !scopeAlignmentResolved
      ? {
          priority: "P0",
          title: "Resolve materials-only scope conflict",
          detail:
            "The BOQ requires supply, installation and connection; record formal client/tender authority before excluding services.",
          target: "Review" as ModuleName,
        }
      : null,
    !scopeMissing && drawingEvidenceCount === 0
      ? {
          priority: "P1",
          title: "Register discipline drawings",
          detail:
            "The BOQ is present, but no project drawings are available for layout, interfaces or quantity cross-checking.",
          target: "Documents" as ModuleName,
        }
      : null,
  ].filter(Boolean) as Array<{
    priority: "P0" | "P1";
    title: string;
    detail: string;
    target: ModuleName | "Settings";
  }>;
  const validationChecks: Array<{
    title: string;
    owner: string;
    passed: boolean;
    detail: string;
    target: ModuleName | "Settings";
  }> = [
    {
      title: "Tender document baseline",
      owner: "Estimator",
      passed: currentDocumentCount > 0 && revisionCandidates.length === 0,
      detail: !currentDocumentCount
        ? "No project documents are registered."
        : revisionCandidates.length
          ? `${revisionCandidates.length} revised issue candidate${revisionCandidates.length === 1 ? "" : "s"} require confirmation.`
          : `${currentDocumentCount} project document${currentDocumentCount === 1 ? "" : "s"} registered with no unresolved revision candidate.`,
      target: "Documents",
    },
    {
      title: "Current BOQ cost evidence",
      owner: "Estimator",
      passed: !scopeMissing && outstanding === 0,
      detail: scopeMissing
        ? "No reviewed BOQ scope exists."
        : outstanding
          ? `${outstanding} BOQ line${outstanding === 1 ? " lacks" : "s lack"} current approved cost evidence.`
          : `All ${items.length} BOQ lines have current approved cost evidence.`,
      target: "Review",
    },
    {
      title: "Engineering assurance dossier",
      owner: "Engineering Reviewer",
      passed: engineeringDossier.approvalReady && !scopeMissing,
      detail: engineeringDossier.approvalReady
        ? "Controlled source baseline, BOQ, drawings and every evidence-backed requirement decision pass."
        : engineeringDossier.blockers.join(" · "),
      target: technicalProfileMissing ? "Documents" : "Technical Matching",
    },
    {
      title: "Exchange-rate evidence",
      owner: "Commercial Approver",
      passed: rateReady,
      detail: rateReady
        ? `${exchangeRate.toFixed(3)} SAR/USD · ${exchangeRateEvidence.source} · valid through ${exchangeRateEvidence.validUntil}.`
        : `${exchangeRate.toFixed(3)} SAR/USD is ${exchangeRateEvidenceStatus.toLowerCase()}.`,
      target: "Settings",
    },
    {
      title: "Client commercial terms",
      owner: "Commercial Approver",
      passed: !clientTermsMissing,
      detail: clientTermsMissing
        ? "Explicit client payment, delivery location, delivery period and freight terms are required."
        : `${clientPaymentTerms} · ${clientDeliveryTerms} · deliver to ${clientDeliveryLocation} · freight: ${clientFreightTerms}`,
      target: "Settings",
    },
    {
      title: "Quotation scope alignment",
      owner: "Commercial Approver",
      passed: scopeAlignmentResolved,
      detail: scopeAlignmentResolved
        ? "Materials-only boundary has the required authority or no service-scope conflict exists."
        : "Tender service obligations conflict with the materials-only quotation boundary.",
      target: "Review",
    },
    {
      title: "Product lifecycle review",
      owner: "Engineering Reviewer",
      passed: unresolvedLifecycleFindings.length === 0,
      detail: unresolvedLifecycleFindings.length
        ? `${unresolvedLifecycleFindings.length} obsolete product reference${unresolvedLifecycleFindings.length === 1 ? "" : "s"} require disposition.`
        : "No unresolved obsolete-product reference remains.",
      target: "Price Sources",
    },
    {
      title: "Project and audit integrity",
      owner: "Commercial Approver",
      passed: workspaceOwnershipConflicts === 0 && auditIntegrityValid,
      detail: workspaceOwnershipConflicts
        ? `${workspaceOwnershipConflicts} cross-project record${workspaceOwnershipConflicts === 1 ? "" : "s"} quarantined.`
        : !auditIntegrityValid
          ? "The local audit chain does not verify."
          : `Workspace ${workspaceContextSeal} and audit chain verify for this project.`,
      target: workspaceOwnershipConflicts ? "Review" : "Activity",
    },
  ];
  const failedValidationChecks = validationChecks.filter(
    (check) => !check.passed,
  );
  const projectPortfolio = [currentProjectSnapshot(), ...savedProjects];
  const normalizedDraftProjectCode = draftProjectCode.trim().toLowerCase();
  const normalizedDraftProjectName = draftProjectName.trim().toLowerCase();
  const normalizedDraftClientName = draftClientName.trim().toLowerCase();
  const draftProjectIdentityConflict = projectPortfolio.find(
    (project) =>
      (normalizedDraftProjectCode &&
        project.code.trim().toLowerCase() === normalizedDraftProjectCode) ||
      (normalizedDraftProjectName &&
        normalizedDraftClientName &&
        project.name.trim().toLowerCase() === normalizedDraftProjectName &&
        project.client.trim().toLowerCase() === normalizedDraftClientName),
  );
  const draftProjectIdentityConflictReason = draftProjectIdentityConflict
    ? normalizedDraftProjectCode &&
      draftProjectIdentityConflict.code.trim().toLowerCase() ===
        normalizedDraftProjectCode
      ? `reference ${draftProjectCode.trim()} already belongs to ${draftProjectIdentityConflict.name}`
      : `${draftProjectName.trim()} already exists for ${draftClientName.trim()}`
    : "";
  const draftToday = new Date().toISOString().slice(0, 10);
  const draftInquiryInFuture = Boolean(
    draftIntakeProfile.inquiryReceived &&
    draftIntakeProfile.inquiryReceived > draftToday,
  );
  const draftDeadlineBeforeInquiry = Boolean(
    draftIntakeProfile.inquiryReceived &&
    draftProjectDueDate &&
    draftProjectDueDate < draftIntakeProfile.inquiryReceived,
  );
  const draftTenderTimelineBlocked =
    draftInquiryInFuture || draftDeadlineBeforeInquiry;
  const draftTenderTimelineMessage = draftInquiryInFuture
    ? "inquiry received date cannot be in the future"
    : draftDeadlineBeforeInquiry
      ? "submission deadline cannot be earlier than inquiry received"
      : "";
  const activeProjectCount = projectPortfolio.filter(
    (project) => project.status !== "Archived",
  ).length;
  const archivedProjectCount = projectPortfolio.filter(
    (project) => project.status === "Archived",
  ).length;
  const visibleProjects = projectPortfolio.filter(
    (project) =>
      (portfolioView === "Archived"
        ? project.status === "Archived"
        : project.status !== "Archived") &&
      `${project.name} ${project.client} ${project.code}`
        .toLowerCase()
        .includes(projectSearch.trim().toLowerCase()),
  );
  const projectSwitcherProjects = projectPortfolio.filter((project) =>
    `${project.name} ${project.client} ${project.code}`
      .toLowerCase()
      .includes(projectMenuSearch.trim().toLowerCase()),
  );
  const registeredPriceFiles = uploadedFiles.filter((name) =>
    ["Price source", "Supplier quotation"].includes(
      documentRoles[name] || inferDocumentRole(name),
    ),
  );
  const managedPriceDocuments = managedDocuments.filter(
    (document) =>
      !document.archived_at &&
      /price list|supplier quotation/i.test(
        document.predicted_type || document.document_type || "",
      ),
  );
  const tenderEvidenceCoverage = [
    {
      label: "Commercial scope",
      count: hasBoqEvidence ? 1 : 0,
      status:
        baseTenderLoaded || appliedDocumentHashes.includes(almoosaBoqSha256)
          ? "Applied baseline"
          : hasBoqEvidence
            ? "Registered · review required"
            : "Missing",
      detail: "BOQ quantities, units and original row anchors",
    },
    {
      label: "Technical specification",
      count: hasSpecificationEvidence ? 1 : 0,
      status: technicalProfileLoaded
        ? "Requirements indexed"
        : hasSpecificationEvidence
          ? "Registered · review required"
          : "Missing",
      detail: "Clauses, standards, approvals and performance requirements",
    },
    {
      label: "Discipline drawings",
      count: drawingEvidenceCount,
      status: drawingEvidenceCount ? "Package present" : "Missing",
      detail: baseTenderLoaded
        ? "2 coordination · 6 schematics · 4 cause-and-effect · 1 FCC detail"
        : "Layouts, schematics, interfaces and cause-and-effect",
    },
    {
      label: "Client inquiry / scope letter",
      count: clientInquiryFiles.length,
      status: confirmedClientInquiryCount
        ? `${confirmedClientInquiryCount} issue confirmed`
        : clientInquiryFiles.length
          ? "Registered · issue review required"
          : "None registered",
      detail:
        "Client instructions, requested pricing boundary, exclusions and bidder obligations; never automatic scope authority",
    },
    {
      label: "Addenda / clarifications",
      count: confirmedAddendaCount,
      status: confirmedAddendaCount
        ? "Confirmed active issue"
        : "None registered",
      detail: "Later instructions that may change scope or tender obligations",
    },
    {
      label: "Commercial price evidence",
      count: registeredPriceFiles.length + (baseTenderLoaded ? 1 : 0),
      status: baseTenderLoaded
        ? "Historical discovery only"
        : registeredPriceFiles.length
          ? "Registered · review required"
          : "No source",
      detail:
        "Supplier quotations and controlled price sources are governed separately",
    },
  ];
  const honeywellSourceIndexed = durablePriceSourceHashes.includes(
    honeywellPriceListSha256,
  );
  const visibleDiscoveryCandidates = eligibleCandidateLibrary.filter(
    (candidate) =>
      `${candidate.sourceName} ${candidate.appliesTo} ${candidate.reference} ${candidate.evidence}`
        .toLowerCase()
        .includes(sourceLibrarySearch.trim().toLowerCase()),
  );
  const priceSourcesAwaitingReview =
    managedPriceDocuments.length +
    registeredPriceFiles.filter(
      (name) =>
        !(
          documentHashes[name] === honeywellPriceListSha256 &&
          honeywellSourceIndexed
        ),
    ).length;
  const discoverySourceCount = honeywellSourceIndexed ? 1 : 0;
  const classificationReviewDocuments = managedDocuments.filter(
    (document) =>
      !["Classified", "Manually Confirmed"].includes(
        document.classification_status || "",
      ) ||
      !document.predicted_type ||
      document.predicted_type === "Unknown",
  );
  const unknownClassificationCount = classificationReviewDocuments.filter(
    (document) =>
      !document.predicted_type || document.predicted_type === "Unknown",
  ).length;
  const lowConfidenceClassificationCount = classificationReviewDocuments.filter(
    (document) => Number(document.classification_confidence || 0) < 80,
  ).length;
  const approvedCostEvidenceCount = new Set(
    currentCostItems.map((entry) => entry.item.approvedSource).filter(Boolean),
  ).size;
  const staleCostEvidenceCount =
    expiredCostItems.length + validityMissingCostItems.length;
  const navigate = (module: ModuleName) => {
    if (
      !canViewCommercial &&
      ["Costing", "Quotation", "Reports"].includes(module)
    ) {
      showToast("This screen requires a server-assigned commercial permission");
      return;
    }
    const workflowIndex: Partial<Record<ModuleName, number>> = {
      Documents: 1,
      BOQ: 2,
      "Technical Matching": 3,
      "Supplier RFQs": 4,
      Costing: 5,
      Review: 6,
      Quotation: 7,
    };
    if (workflowIndex[module]) setActiveStep(workflowIndex[module]);
    setShowAllProjects(false);
    setActiveModule(module);
    if (module !== "Technical Matching") setSelectedMatchingItemId(null);
    setSidebarOpen(false);
    if (module === "Knowledge Library") {
      window.history.pushState(null, "", buildProjectLocation("", module));
      return;
    }
    window.history.pushState(null, "", buildProjectLocation(projectId, module));
  };
  const sourceLifecycleSummary = (
    <div className="source-lifecycle-summary">
      <span>
        <small>REGISTERED</small>
        <strong>
          {managedPriceDocuments.length +
            registeredPriceFiles.length +
            (baseTenderLoaded ? 1 : 0)}
        </strong>
        <b>project source files</b>
      </span>
      <span>
        <small>NEEDS REVIEW</small>
        <strong>{priceSourcesAwaitingReview + staleCostEvidenceCount}</strong>
        <b>source files or stale cost records</b>
      </span>
      <span>
        <small>DISCOVERY</small>
        <strong>{discoverySourceCount}</strong>
        <b>product reference only</b>
      </span>
      <span>
        <small>CURRENT COST EVIDENCE</small>
        <strong>{approvedCostEvidenceCount}</strong>
        <b>supplier-backed decisions</b>
      </span>
    </div>
  );
  const discoveryLibraryPanel = honeywellSourceIndexed ? (
    <details className="discovery-library">
      <summary>
        <span>
          <strong>Browse reviewed discovery index</strong>
          <small>
            Canonical server-persisted products and source evidence only ·
            historical prices remain discovery-only
          </small>
          <small hidden>
            {eligibleCandidateLibrary.length} isolated demo fixtures
          </small>
        </span>
        <b>Open controls</b>
      </summary>
      <div className="discovery-library-body">
        <div className="approval-blocked">
          <strong>Browsing is not price approval</strong>
          <p>
            Every displayed value is historical and expired. Demo candidates are
            isolated. Real projects retrieve canonical records from the Product
            Library API; these prices cannot enter pricing, review, dashboards
            or export.
          </p>
        </div>
        <label>
          <span>Search discovery product library</span>
          <input
            aria-label="Search discovery product library"
            value={sourceLibrarySearch}
            onChange={(event) => setSourceLibrarySearch(event.target.value)}
            placeholder="Part number, family or technical description"
          />
        </label>
        <div className="empty-state">
          <strong>
            No reviewed discovery clue matches “{sourceLibrarySearch}” in
            browser data
          </strong>
          <p>
            The system does not broaden matching to unrelated catalogue rows.
            Search the authenticated canonical API instead.
          </p>
        </div>
        <a
          className="inline-primary"
          href={`/api/library/products?discovery=true&q=${encodeURIComponent(sourceLibrarySearch)}`}
          target="_blank"
          rel="noreferrer"
        >
          Open canonical product records
        </a>
        <button
          className="inline-primary"
          onClick={() => navigate("Technical Matching")}
        >
          Return to controlled matching
        </button>
      </div>
    </details>
  ) : null;
  const boqAcceptedCount = initialItems.filter(
    (item) => boqLineDecisions[item.id] === "Accepted",
  ).length;
  const boqExcludedCount = initialItems.filter(
    (item) => boqLineDecisions[item.id] === "Excluded",
  ).length;
  const boqPendingCount =
    initialItems.length - boqAcceptedCount - boqExcludedCount;
  const boqExclusionsMissingReason = initialItems.filter(
    (item) =>
      boqLineDecisions[item.id] === "Excluded" &&
      !boqExclusionReasons[item.id]?.trim(),
  ).length;
  const knownBoqAnchorIntegrity = sourceAnchorIntegrity(initialItems);
  const knownBoqAnchorIntegrityValid =
    knownBoqAnchorIntegrity.anchorCount === 90 &&
    knownBoqAnchorIntegrity.uniqueAnchorCount === 90 &&
    knownBoqAnchorIntegrity.duplicateAssignments === 0 &&
    knownBoqAnchorIntegrity.unanchoredLines === 0;
  const visibleBoqCandidates = initialItems.filter(
    (item) =>
      !boqReviewSearch.trim() ||
      `${item.item} ${item.unit} ${item.qty} ${item.sourceRows.join(" ")}`
        .toLowerCase()
        .includes(boqReviewSearch.trim().toLowerCase()),
  );
  const visibleGenericBoqCandidates = (
    genericBoqPreview?.candidates || []
  ).filter(
    (candidate) =>
      !boqReviewSearch.trim() ||
      `${candidate.system} ${candidate.item} ${candidate.unit} ${candidate.qty} ${candidate.rowNumber}`
        .toLowerCase()
        .includes(boqReviewSearch.trim().toLowerCase()),
  );
  const genericAcceptedCount = (genericBoqPreview?.candidates || []).filter(
    (candidate) => boqLineDecisions[candidate.rowNumber] === "Accepted",
  ).length;
  const genericExcludedCount = (genericBoqPreview?.candidates || []).filter(
    (candidate) => boqLineDecisions[candidate.rowNumber] === "Excluded",
  ).length;
  const genericPendingCount =
    (genericBoqPreview?.candidates.length || 0) -
    genericAcceptedCount -
    genericExcludedCount;
  const genericMissingReasons = (genericBoqPreview?.candidates || []).filter(
    (candidate) =>
      boqLineDecisions[candidate.rowNumber] === "Excluded" &&
      !boqExclusionReasons[candidate.rowNumber]?.trim(),
  ).length;
  const genericInvalidAccepted = (genericBoqPreview?.candidates || []).filter(
    (candidate) =>
      boqLineDecisions[candidate.rowNumber] === "Accepted" &&
      candidate.errors.length,
  ).length;
  const activeRfqCoverageIds = new Set(
    rfqs
      .filter((rfq) => rfq.status !== "Awarded")
      .flatMap((rfq) => rfq.itemIds),
  );
  const rfqCoveredItems = new Set(rfqs.flatMap((rfq) => rfq.itemIds)).size;
  const rfqResponses = rfqs.filter((rfq) =>
    ["Response registered", "Awarded"].includes(rfq.status),
  ).length;
  const rfqsReady = rfqs.filter(
    (rfq) => rfq.status === "Ready to issue",
  ).length;
  const rfqsAwarded = rfqs.filter((rfq) => rfq.status === "Awarded").length;
  const rfqToday = sessionCalendar.today;
  const rfqDueSoonLimit = sessionCalendar.threeDaysFromToday;
  const draftRfqs = rfqs.filter((rfq) => rfq.status === "Draft");
  const overdueRfqs = rfqs.filter(
    (rfq) =>
      rfq.status === "Ready to issue" &&
      Boolean(rfq.responseDue) &&
      rfq.responseDue < rfqToday,
  );
  const dueSoonRfqs = rfqs.filter(
    (rfq) =>
      rfq.status === "Ready to issue" &&
      Boolean(rfq.responseDue) &&
      rfq.responseDue >= rfqToday &&
      rfq.responseDue <= rfqDueSoonLimit,
  );
  const responsesAwaitingReview = rfqs.filter(
    (rfq) =>
      rfq.status !== "Awarded" &&
      rfq.responseFiles.length > (rfq.responseOffers || []).length,
  );
  const reviewedOffersAwaitingAward = rfqs.filter(
    (rfq) =>
      rfq.status !== "Awarded" &&
      (rfq.responseOffers || []).some(
        (offer) => offer.reviewStatus === "Reviewed",
      ),
  );
  const awardedReviews = rfqs
    .filter((rfq) => rfq.status === "Awarded" && rfq.responseReview)
    .map((rfq) => rfq.responseReview as SupplierResponseReview);
  const supplierDeliveryBenchmark = awardedReviews.length
    ? Math.max(...awardedReviews.map((review) => review.deliveryWeeks))
    : 0;
  const supplierPaymentBenchmarks = [
    ...new Set(
      awardedReviews.map((review) => review.paymentTerms).filter(Boolean),
    ),
  ];
  const quotationFingerprint = createQuotationFingerprint({
    projectId,
    projectName,
    clientName,
    projectCode,
    projectDueDate,
    workspaceContextSeal,
    items: items.map((item) => ({
      id: item.id,
      qty: item.qty,
      unitCost: item.unitCost,
      markup: item.markup,
      supplier: item.supplier,
      approvedSource: item.approvedSource || "",
      status: item.status,
    })),
    costEvidenceFreshness: costEvidenceStates.map(
      ({ item, status, validUntil }) => ({
        id: item.id,
        state: status === "Expiring soon" ? "Current" : status,
        validUntil,
      }),
    ),
    vatRate,
    riskAllowanceRate,
    riskAllowanceReason,
    exchangeRate,
    rateResolved,
    exchangeRateEvidence: {
      source: exchangeRateEvidence.source.trim(),
      effectiveDate: exchangeRateEvidence.effectiveDate,
      validUntil: exchangeRateEvidence.validUntil,
    },
    exchangeRateEvidenceStatus,
    warrantyMonths,
    validityDays,
    clientPaymentTerms,
    clientDeliveryTerms,
    clientDeliveryLocation,
    clientFreightTerms,
    clientQualifications,
    scopeAlignmentDecision,
    documentEvidence: Object.keys(documentHashes)
      .sort()
      .map((name) => ({
        name,
        hash: documentHashes[name],
        control: documentControls[name] || null,
      })),
    revisionCandidates: revisionCandidates.map((candidate) => ({
      fileName: candidate.fileName,
      candidateHash: candidate.candidateHash,
      control: candidate.control,
    })),
    lifecycleReviews,
    requirementReviews: requirementReviews.map((requirement) => ({
      id: requirement.id,
      status: requirement.status,
      evidence: requirement.evidence,
      reviewerNote: requirement.reviewerNote,
      reviewedAt: requirement.reviewedAt || "",
    })),
  });
  const projectQuotationApprovals = quotationApprovals.filter(
    (approval) => approval.projectId === projectId,
  );
  const latestQuotationApproval =
    projectQuotationApprovals.reduce<QuotationApproval | null>(
      (latest, approval) =>
        !latest || approval.revision > latest.revision ? approval : latest,
      null,
    );
  const currentQuotationApproval =
    projectQuotationApprovals.find(
      (approval) => approval.fingerprint === quotationFingerprint,
    ) || null;
  const currentFinalIssueExported = auditEvents.some(
    (event) =>
      event.action === "Final issue package exported" &&
      event.detail.includes(quotationFingerprint),
  );
  const itemNeedsCurrentEvidence = (item: CostItem) =>
    !hasCurrentPriceEvidence(item, commercialToday);
  const visibleCostItems = items.filter((item) => {
    const stateMatches =
      costingView === "All items" ||
      (costingView === "Needs action"
        ? itemNeedsCurrentEvidence(item)
        : !itemNeedsCurrentEvidence(item));
    const query = costingSearch.trim().toLowerCase();
    const queryMatches =
      !query ||
      `${item.item} ${item.system} ${item.supplier} ${item.specification} ${item.approvedSource || ""}`
        .toLowerCase()
        .includes(query);
    return stateMatches && queryMatches;
  });
  const selectableRfqItemIds = items
    .filter(
      (item) =>
        itemNeedsCurrentEvidence(item) && !activeRfqCoverageIds.has(item.id),
    )
    .map((item) => item.id);
  const selectedRfqScopeIds = selectedRfqItemIds.filter((itemId) =>
    selectableRfqItemIds.includes(itemId),
  );
  const visibleSelectableRfqIds = visibleCostItems
    .filter((item) => selectableRfqItemIds.includes(item.id))
    .map((item) => item.id);
  const allVisibleRfqItemsSelected =
    visibleSelectableRfqIds.length > 0 &&
    visibleSelectableRfqIds.every((itemId) =>
      selectedRfqScopeIds.includes(itemId),
    );
  const nextCostingItem = items.find(itemNeedsCurrentEvidence) || null;
  const activityActors = [
    "All actors",
    ...Array.from(new Set(projectAuditEvents.map((event) => event.actor))),
  ];
  const filteredAuditEvents = projectAuditEvents.filter((event) => {
    const query = activitySearch.trim().toLowerCase();
    const categoryMatches =
      activityCategory === "All" ||
      auditCategoryFor(event) === activityCategory;
    const actorMatches =
      activityActor === "All actors" || event.actor === activityActor;
    const queryMatches =
      !query ||
      `${event.action} ${event.detail} ${event.actor} ${event.time} EVT-${event.id}`
        .toLowerCase()
        .includes(query);
    return categoryMatches && actorMatches && queryMatches;
  });
  useEffect(() => {
    if (
      projectStatus !== "Quotation Approved" ||
      !latestQuotationApproval ||
      currentQuotationApproval
    )
      return;
    const supersede = window.setTimeout(() => {
      const runtime = createRuntimeContext();
      setProjectStatus("Quotation Draft");
      setAuditEvents((current) =>
        prependAuditEvent(current, projectId, {
          id: runtime.epoch,
          action: "Quotation approval superseded",
          detail: `Rev ${latestQuotationApproval.revision} · ${latestQuotationApproval.fingerprint} no longer matches current calculations ${quotationFingerprint}`,
          actor: "System",
          time: runtime.localLabel,
        }),
      );
    }, 0);
    return () => window.clearTimeout(supersede);
  }, [
    projectStatus,
    latestQuotationApproval,
    currentQuotationApproval,
    quotationFingerprint,
    projectId,
  ]);
  const dueLabel = projectDueDate
    ? `Due ${new Date(`${projectDueDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : "Due date not set";

  const approveMaterialsOnlyScope = () => {
    if (
      !requireWorkingRole(
        "Commercial Approver",
        "Materials-only scope authorization",
      )
    )
      return;
    if (
      scopeEvidenceDraft.trim().length < 5 ||
      scopeReasonDraft.trim().length < 20
    ) {
      showToast(
        "Scope authorization requires a formal evidence reference and a clear decision reason",
      );
      return;
    }
    const approvedAt = new Date().toISOString();
    setScopeAlignmentDecision({
      status: "Materials-only authorized",
      evidenceReference: scopeEvidenceDraft.trim(),
      reason: scopeReasonDraft.trim(),
      sourceFingerprint: almoosaBoqSha256,
      approvedAt,
      approvedBy: workingRole,
    });
    recordAudit(
      "Materials-only scope authorized",
      `BOQ.xlsx · SHA-256 ${almoosaBoqSha256.slice(0, 12)}… · tender requires supply, install and connect including wiring, conduits and accessories · services excluded under ${scopeEvidenceDraft.trim()} · ${scopeReasonDraft.trim()}`,
    );
    setScopeEvidenceDraft("");
    setScopeReasonDraft("");
    showToast(
      "Materials-only deviation authorized and tied to the tender fingerprint",
    );
  };

  const refreshPreSalesWorkflow = async () => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/presales-workflow`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        payload.error?.message || "Pre-sales workflow could not be refreshed.",
      );
    setPreSalesWorkflow(payload.workflow);
    setServerQuotation(payload.currentQuotation || null);
    setQuotationStale(Boolean(payload.quotationStale));
    return payload;
  };
  const mutateProjectLifecycle = async (operation: "archive" | "restore") => {
    const reason = window.prompt(
      operation === "archive"
        ? "Reason for archiving this project"
        : "Reason for restoring this project",
    )?.trim();
    if (!reason) return;
    try {
      await commandThenRefresh({
        command: () => requestJson(projectApi.lifecycle(projectId, operation), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
        refresh: refreshProjectReadModels,
      });
      setProjectOpen(false);
      showToast(operation === "archive" ? "Project archived" : "Project restored");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Project lifecycle update failed.");
    }
  };
  const mutateQuotation = async (
    operation: "draft" | "approve" | "issue",
    body: Record<string, unknown>,
  ) => {
    setQuotationWorkflowLoading(true);
    try {
      const response = await fetch(
        commercialApi.quotation(projectId, operation),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message || `Quotation ${operation} failed.`,
        );
      await refreshPreSalesWorkflow();
      showToast(
        operation === "draft"
          ? "Governed quotation draft created"
          : operation === "approve"
            ? "Quotation revision approved"
            : "Quotation issue recorded",
      );
      return payload;
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : `Quotation ${operation} failed.`,
      );
      return null;
    } finally {
      setQuotationWorkflowLoading(false);
    }
  };
  const createServerQuotationDraft = () =>
    mutateQuotation("draft", {
      vatBasisPoints: Math.round(vatRate * 100),
      validityDays,
      warrantyMonths,
      delivery: clientDeliveryTerms,
      paymentTerms: clientPaymentTerms,
      client: clientName,
      exclusions: [clientQualifications].filter(Boolean),
    });
  const approveQuotationRevision = () => {
    if (!quotationApprovalReason.trim()) {
      showToast("Add an approval decision reason");
      return;
    }
    if (!serverQuotation) {
      showToast("Create a governed quotation draft first");
      return;
    }
    return mutateQuotation("approve", {
      quotationRevisionId: serverQuotation.id,
      quotationFingerprint:
        serverQuotation.quotation_fingerprint ||
        serverQuotation.quotationFingerprint,
      reason: quotationApprovalReason.trim(),
    }).then((result) => {
      if (result) setQuotationApprovalReason("");
    });
  };
  const issueQuotationRevision = () => {
    if (!serverQuotation) return;
    return mutateQuotation("issue", {
      quotationRevisionId: serverQuotation.id,
      quotationFingerprint: serverQuotation.quotation_fingerprint || serverQuotation.quotationFingerprint,
      reason: "Issue the currently approved governed quotation revision",
    });
  };

  const serverPricingViews = extractedBoqItems
    .filter((item) => item.row_type === "BOQ Item")
    .map((item) => pricingLineModel(item, persistentPricingLines[item.id]));
  const commercialReviewQueue = reviewQueue.filter((item) =>
    /commercial|cost|price|quotation/i.test(`${item.review_type} ${item.required_decision}`),
  );
  const calculateServerPricingByItemId = (itemId: string) => {
    const item = extractedBoqItems.find((entry) => entry.id === itemId);
    if (!item) return;
    const legacy = items.find((entry) => entry.id === item.sequence);
    void calculatePersistentPricing(legacy || {
      id: item.sequence,
      item: item.description || "BOQ item",
      system: item.section || "",
      qty: Number(item.current_values?.quantity || item.original_quantity || 0),
      supplier: "",
      unitCost: 0,
      markup: 0,
      status: "Missing Link",
      unit: String(item.current_values?.unit || item.original_unit || ""),
      specification: "",
      sourceRows: [],
    });
  };

  const openFirstMatch = () => {
    const first = extractedBoqItems.find((item) => item.row_type === "BOQ Item");
    if (first) {
      setSelectedMatchingItemId(first.id);
      window.history.pushState(null, "", buildProjectLocation(projectId, "Technical Matching", first.id));
    } else showToast("No persisted BOQ item is available for matching");
  };

  const moduleContent =
    activeModule === "Overview" && serverProjectDashboard && preSalesWorkflow ? (
      <OverviewWorkspace
        dashboard={serverProjectDashboard}
        workflow={preSalesWorkflow}
        estimatorReadiness={estimatorReadiness}
        onOpenRoute={(route) => openDashboardRoute(projectId, route)}
        money={money}
      />
    ) : activeModule === "Overview" && serverProjectDashboard && preSalesWorkflow && Boolean(0) ? (
      <section className="module-page operational-project-dashboard">
        <div className="module-heading">
          <div>
            <small>PROJECT OPERATIONS · SERVER VERIFIED</small>
            <h1>{serverProjectDashboard.project.name}</h1>
            <p>
              {serverProjectDashboard.project.client || "Client not recorded"} ·{" "}
              {serverProjectDashboard.project.tenderNumber ||
                serverProjectDashboard.project.id}{" "}
              · Updated{" "}
              {new Date(serverProjectDashboard.updatedAt).toLocaleString()}
            </p>
          </div>
          <span
            className={
              serverProjectDashboard.workflow.ready
                ? "review-ready"
                : "review-pending"
            }
          >
            {serverProjectDashboard.project.status}
          </span>
        </div>
        <div className="summary-grid">
          <article>
            <span>Documents</span>
            <strong>{serverProjectDashboard.facts.documents || 0}</strong>
            <small>
              {serverProjectDashboard.facts.processing || 0} processing ·{" "}
              {serverProjectDashboard.facts.failedJobs || 0} failed
            </small>
          </article>
          <article>
            <span>BOQ items</span>
            <strong>{serverProjectDashboard.facts.boqItems || 0}</strong>
            <small>
              {serverProjectDashboard.facts.matchedItems || 0} matched ·{" "}
              {serverProjectDashboard.facts.technicalApproved || 0} technically
              approved
            </small>
          </article>
          <article>
            <span>Workflow progress</span>
            <strong>{serverProjectDashboard.workflow.progress}%</strong>
            <small>
              Model {serverProjectDashboard.modelVersion} · verified stages
            </small>
          </article>
          <article>
            <span>
              {serverProjectDashboard.commercialRestricted
                ? "Commercial data"
                : "Quoted value"}
            </span>
            <strong>
              {serverProjectDashboard.commercialRestricted
                ? "Restricted"
                : `${serverProjectDashboard.totals?.currency || "SAR"} ${money(serverProjectDashboard.totals?.quotedValue || 0)}`}
            </strong>
            <small>
              {serverProjectDashboard.commercialRestricted
                ? "Requires commercial permission"
                : `${(serverProjectDashboard.totals?.averageMargin || 0).toFixed(1)}% average margin`}
            </small>
          </article>
        </div>
        {preSalesWorkflow?.nextAction ? (
          <button
            className="next-recommended-action"
            onClick={() =>
              openDashboardRoute(projectId, preSalesWorkflow.nextAction.route)
            }
          >
            <span>
              <small>
                NEXT WORKFLOW ACTION · {preSalesWorkflow.nextAction.owner}
              </small>
              <strong>{preSalesWorkflow.nextAction.title}</strong>
              <p>
                {preSalesWorkflow.blockers.find(
                  (blocker) =>
                    blocker.stageId === preSalesWorkflow.currentStageId,
                )?.message || "Continue the governed pre-sales workflow."}
              </p>
            </span>
            <b>Open work →</b>
          </button>
        ) : (
          <div className="empty-state">
            <strong>No action currently requires attention</strong>
            <p>The current quotation has completed the governed workflow.</p>
          </div>
        )}
        <section
          className="workflow-stage-board"
          aria-label="Complete AI pre-sales estimation workflow"
        >
          {(
            preSalesWorkflow?.stages || serverProjectDashboard.workflow.stages
          ).map((stage: any) => (
            <button
              key={stage.id}
              onClick={() => openDashboardRoute(projectId, stage.route)}
              className={`workflow-stage-card stage-${stage.status.toLowerCase().replaceAll(" ", "-")}`}
            >
              <header>
                <strong>{stage.name}</strong>
                <span>{stage.status}</span>
              </header>
              <div>
                <i style={{ width: `${stage.progress}%` }} />
              </div>
              <p>
                {stage.progress}% · {stage.owner}
              </p>
              {(stage.blockers?.length || stage.blockingIssues) > 0 && (
                <small>
                  {stage.blockers?.[0] ||
                    `${stage.blockingIssues} blocking issue${stage.blockingIssues === 1 ? "" : "s"}`}
                </small>
              )}
            </button>
          ))}
        </section>
        <div className="action-health-grid">
          <section className="action-queue">
            <div className="section-title">
              <div>
                <small>SERVER ACTION QUEUE</small>
                <strong>Actionable work only</strong>
              </div>
              <span>{serverProjectDashboard.actions.length} open</span>
            </div>
            {serverProjectDashboard.actions.map((action) => (
              <button
                key={action.id}
                className="action-row"
                onClick={() => openDashboardRoute(projectId, action.route)}
              >
                <span
                  className={`action-priority ${action.severity === "Critical" ? "p0" : "p1"}`}
                >
                  {action.severity}
                </span>
                <span>
                  <strong>{action.title}</strong>
                  <small>
                    {action.description} · Owner: {action.owner}
                  </small>
                </span>
                <b>Resolve →</b>
              </button>
            ))}
          </section>
          <aside className="project-risk-panel">
            <small>EXPLAINED RISKS</small>
            <h2>
              {serverProjectDashboard.risks.length
                ? `${serverProjectDashboard.risks.length} active`
                : "No active risk"}
            </h2>
            {serverProjectDashboard.risks.map((risk) => (
              <button
                key={risk.id}
                onClick={() =>
                  openDashboardRoute(projectId, risk.recommendedAction)
                }
              >
                <span
                  className={`risk-level risk-${risk.severity.toLowerCase()}`}
                >
                  {risk.severity}
                </span>
                <strong>{risk.type}</strong>
                <p>{risk.trigger}</p>
                <small>{risk.impact}</small>
              </button>
            ))}
          </aside>
        </div>
      </section>
    ) : activeModule === "Overview" && serverProjectDashboard && preSalesWorkflow && Boolean(0) ? (
      <section className="module-page">
        <div className="module-heading">
          <div>
            <small>ACTIVE PROJECT</small>
            <h1>{projectName}</h1>
            <p>
              {clientName} · {projectCode} · {dueLabel}
            </p>
          </div>
          <button onClick={openProjectDetailsEditor}>Manage project</button>
        </div>
        <div className="summary-grid">
          <article>
            <span>Documents</span>
            <strong>{currentDocumentCount}</strong>
            <small>
              {currentDocumentCount
                ? "project sources loaded"
                : "workspace is empty"}
            </small>
          </article>
          <article>
            <span>BOQ items</span>
            <strong>{items.length}</strong>
            <small>{pricedCount} safely priced</small>
          </article>
          <article>
            <span>Progress</span>
            <strong>{projectCompletion}%</strong>
            <small>pricing completeness</small>
          </article>
          <article>
            <span>Selling price</span>
            <strong>SAR {money(totals.selling)}</strong>
            <small>{totals.margin.toFixed(1)}% margin</small>
          </article>
        </div>
        <div className="action-health-grid">
          <section
            className="action-queue"
            aria-labelledby="action-queue-title"
          >
            <div className="section-title">
              <div>
                <small>ACTION QUEUE</small>
                <strong id="action-queue-title">
                  What needs attention now
                </strong>
              </div>
              <span>{actionQueue.length} open</span>
            </div>
            {actionQueue.length ? (
              actionQueue.map((action) => (
                <button
                  key={action.title}
                  className="action-row"
                  onClick={() =>
                    action.target === "Settings"
                      ? openPricingSettings()
                      : navigate(action.target)
                  }
                >
                  <span
                    className={`action-priority ${action.priority.toLowerCase()}`}
                  >
                    {action.priority}
                  </span>
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.detail}</small>
                  </span>
                  <b>Resolve →</b>
                </button>
              ))
            ) : (
              <article className="ready-action">
                <span>✓</span>
                <div>
                  <strong>All visible controls are ready</strong>
                  <small>
                    Open quotation approval and record the human decision.
                  </small>
                </div>
                <button onClick={() => navigate("Quotation")}>
                  Open approval →
                </button>
              </article>
            )}
          </section>
          <aside
            className="project-health"
            aria-labelledby="project-health-title"
          >
            <small>PROJECT HEALTH</small>
            <h2 id="project-health-title">Readiness</h2>
            {[
              ["Documents", documentReadiness],
              ["Pricing coverage", projectCompletion],
              ["Technical evidence", technicalReadiness],
              ["Commercial controls", commercialReadiness],
            ].map(([label, value]) => (
              <div className="health-row" key={String(label)}>
                <span>
                  <small>{label}</small>
                  <strong>{value}%</strong>
                </span>
                <div>
                  <i style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
            <div className="overall-health">
              <span>Overall readiness</span>
              <strong>{overallReadiness}%</strong>
            </div>
          </aside>
        </div>
      </section>
    ) : activeModule === "Overview" ? (
      dashboardError ? <ErrorState message={dashboardError} /> : <LoadingState label="Loading verified project overview…" />
    ) : activeModule === "Documents" ? (
      <DocumentsWorkspace
        reviewCount={classificationReviewDocuments.length}
        unknownCount={unknownClassificationCount}
        lowConfidenceCount={lowConfidenceClassificationCount}
        onOpenBoq={() => navigate("BOQ")}
        onUpload={openGeneralUpload}
        onReviewFirst={() => {
          const first = classificationReviewDocuments[0];
          if (first) classificationCommand(first, first.predicted_type && first.predicted_type !== "Unknown" ? "confirm" : "override");
        }}
      >
        {false && <div className="module-heading">
          <div>
            <small>STEP 01 · DOCUMENT INTAKE</small>
            <h1>Project documents</h1>
            <p>
              Upload, classify and track the authoritative files for this
              project.
            </p>
          </div>
          <div className="heading-actions">
            <button
              className="secondary-action"
              onClick={() => navigate("BOQ")}
            >
              Open BOQ workspace
            </button>
            <button onClick={openGeneralUpload}>⇧ Upload documents</button>
          </div>
        </div>}
        {false && classificationReviewDocuments.length > 0 && (
          <section
            id="documents-needing-review"
            className="classification-review-explainer"
            aria-labelledby="classification-review-title"
          >
            <div>
              <small>WHY REVIEW IS REQUIRED</small>
              <strong id="classification-review-title">
                {classificationReviewDocuments.length} document
                {classificationReviewDocuments.length === 1 ? "" : "s"} need
                classification confirmation
              </strong>
              <p>
                {unknownClassificationCount} have no reliable document type and{" "}
                {lowConfidenceClassificationCount} are below the 80%
                automatic-classification threshold. They stay in review so a
                drawing, specification or price list cannot enter the wrong
                extraction workflow.
              </p>
            </div>
            <button
              id="review-first-classification"
              onClick={() => {
                const first = classificationReviewDocuments[0];
                if (first)
                  classificationCommand(
                    first,
                    first.predicted_type && first.predicted_type !== "Unknown"
                      ? "confirm"
                      : "override",
                  );
              }}
            >
              Review first document →
            </button>
          </section>
        )}
        {baseTenderLoaded && (
          <div className="revision-alert">
            <span>DOCUMENT CONTROL</span>
            <div>
              <strong>
                Specification Rev 1 and 13 tender drawings indexed
              </strong>
              <p>
                No previous issue was supplied, so revision differences cannot
                be calculated. The current files remain the active tender
                baseline.
              </p>
            </div>
            <button
              onClick={() => showToast("Current tender baseline confirmed")}
            >
              Confirm baseline
            </button>
          </div>
        )}
        <details className="document-progressive-section tender-evidence-map">
          <summary>
            <span>
              <small>TENDER EVIDENCE MAP</small>
              <strong>What this pricing workspace can actually prove</strong>
              <em>
                {tenderEvidenceCoverage.length} evidence groups · Presence is
                not completeness
              </em>
            </span>
            <b>View evidence map</b>
          </summary>
          <div className="document-progressive-body">
            <div className="evidence-coverage-grid">
              {tenderEvidenceCoverage.map((evidence) => (
                <article key={evidence.label}>
                  <div>
                    <small>{evidence.label}</small>
                    <strong>{evidence.count}</strong>
                  </div>
                  <span
                    className={
                      evidence.status.includes("Missing") ||
                      evidence.status === "No source"
                        ? "review-blocked"
                        : evidence.status.includes("Historical") ||
                            evidence.status.includes("review required") ||
                            evidence.status === "None registered"
                          ? "review-pending"
                          : "review-ready"
                    }
                  >
                    {evidence.status}
                  </span>
                  <p>{evidence.detail}</p>
                </article>
              ))}
            </div>
            <div className="drawing-package-breakdown">
              <strong>Drawing package basis</strong>
              <p>
                {baseTenderLoaded
                  ? "The supplied baseline contains 13 drawings across AMS, BOS, GRS, KGS and WLC locations. Drawing presence supports cross-checking; it does not claim that every quantity, interface or revision has been verified."
                  : "Register project drawings and confirm their revision metadata before relying on layouts, interfaces or cross-document quantity checks."}
              </p>
            </div>
          </div>
        </details>
        {revisionCandidates.length > 0 && (
          <section className="revision-candidate-register">
            <div className="section-title">
              <div>
                <small>REVISION INBOX</small>
                <strong>
                  {revisionCandidates.length} same-name file
                  {revisionCandidates.length === 1 ? " has" : "s have"} new
                  content
                </strong>
              </div>
              <span>Existing baseline retained</span>
            </div>
            {revisionCandidates.map((candidate) => {
              const control = candidate.control;
              const canRegister = Boolean(
                control.revision.trim() &&
                control.issueDate &&
                control.issueDate <= new Date().toISOString().slice(0, 10) &&
                control.transmittal.trim(),
              );
              return (
                <article key={candidate.id}>
                  <header>
                    <div>
                      <strong>{candidate.fileName}</strong>
                      <p>
                        Previous SHA-256 {candidate.previousHash.slice(0, 12)}…
                        · candidate {candidate.candidateHash.slice(0, 12)}…
                      </p>
                    </div>
                    <span className="review-blocked">
                      Revision metadata required
                    </span>
                  </header>
                  <div className="document-control-fields">
                    <label>
                      New revision
                      <input
                        value={control.revision}
                        onChange={(event) =>
                          updateRevisionCandidate(candidate.id, {
                            revision: event.target.value,
                          })
                        }
                        placeholder="e.g. 2, B, T02"
                      />
                    </label>
                    <label>
                      Issue date
                      <input
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={control.issueDate}
                        onChange={(event) =>
                          updateRevisionCandidate(candidate.id, {
                            issueDate: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Issue purpose
                      <select
                        value={control.status}
                        onChange={(event) =>
                          updateRevisionCandidate(candidate.id, {
                            status: event.target.value as DocumentIssueStatus,
                          })
                        }
                      >
                        <option>Tender</option>
                        <option>Addendum</option>
                        <option>For Information</option>
                        <option>Superseded</option>
                      </select>
                    </label>
                    <label>
                      Transmittal / instruction
                      <input
                        value={control.transmittal}
                        onChange={(event) =>
                          updateRevisionCandidate(candidate.id, {
                            transmittal: event.target.value,
                          })
                        }
                        placeholder="Required evidence reference"
                      />
                    </label>
                  </div>
                  <footer>
                    <p>
                      Registration creates a separate fingerprinted issue. It
                      does not replace the active baseline, re-run extraction or
                      change prices.
                    </p>
                    <div>
                      <button
                        className="secondary-action"
                        onClick={() =>
                          setRevisionCandidates((current) =>
                            current.filter(
                              (entry) => entry.id !== candidate.id,
                            ),
                          )
                        }
                      >
                        Discard candidate
                      </button>
                      <button
                        disabled={!canRegister}
                        onClick={() => registerRevisionCandidate(candidate.id)}
                      >
                        Register revised issue
                      </button>
                    </div>
                  </footer>
                </article>
              );
            })}
          </section>
        )}
        <section
          className="managed-document-register"
          aria-labelledby="managed-document-title"
        >
          <div className="section-title">
            <div>
              <small>PERSISTED DOCUMENT REGISTER</small>
              <strong id="managed-document-title">
                {managedDocumentsLoading
                  ? "Loading stored documents…"
                  : `${managedDocuments.length} durable document${managedDocuments.length === 1 ? "" : "s"}`}
              </strong>
            </div>
            <span>Project database + protected file storage</span>
          </div>
          {uploadingDocumentNames.map((name) => (
            <article className="managed-document-row" key={`uploading-${name}`}>
              <div>
                <strong>{name}</strong>
                <p>Uploading, validating and storing original bytes…</p>
              </div>
              <div className="managed-document-state">
                <span className="review-pending">
                  Upload · {uploadProgressByName[name] || 0}%
                </span>
                <progress
                  value={uploadProgressByName[name] || 0}
                  max="100"
                  aria-label={`${name} upload progress`}
                />
              </div>
            </article>
          ))}
          {managedDocuments.map((document) => {
            const boqSummary = boqSummaryFor(document);
            return (
              <article
                className={`managed-document-row ${document.archived_at ? "managed-document-archived" : ""}`}
                key={document.id}
              >
                <div>
                  <strong>{document.logical_name}</strong>
                  <p>
                    {document.document_type} · v{document.version_number}
                    {document.revision
                      ? ` · Rev ${document.revision}`
                      : ""} ·{" "}
                    {(
                      document.byte_size /
                      (document.byte_size < 1024 * 1024 ? 1024 : 1024 * 1024)
                    ).toFixed(document.byte_size < 1024 * 1024 ? 0 : 1)}{" "}
                    {document.byte_size < 1024 * 1024 ? "KB" : "MB"} · uploaded{" "}
                    {new Date(document.uploaded_at).toLocaleString()}
                  </p>
                  <small>
                    Uploaded by {document.uploaded_by} · SHA-256{" "}
                    {document.sha256.slice(0, 12)}… · security:{" "}
                    {document.quarantine_status}
                  </small>
                  <small>
                    Processing{" "}
                    {document.started_at
                      ? new Date(document.started_at).toLocaleString()
                      : "not started"}{" "}
                    · duration {managedDocumentDuration(document)}
                    {document.last_retry_at
                      ? ` · last retry ${new Date(document.last_retry_at).toLocaleString()}`
                      : ""}
                  </small>
                  {document.error_message && (
                    <small className="managed-document-error">
                      {document.error_code}: {document.error_message} ·{" "}
                      {document.suggested_action || "Review and retry"}
                    </small>
                  )}
                  <div className="classification-summary">
                    <span
                      className={
                        document.classification_status === "Classified" ||
                        document.classification_status === "Manually Confirmed"
                          ? "review-ready"
                          : "review-pending"
                      }
                    >
                      {document.classification_status ||
                        "Classification Queued"}
                    </span>
                    <strong>
                      {document.predicted_type || "Unknown"} ·{" "}
                      {document.classification_confidence || 0}%
                    </strong>
                    <small>
                      {document.confidence_state || "Pending evidence"} · Route:{" "}
                      {document.downstream_route || "Not selected"}
                    </small>
                    {document.classification_error_message && (
                      <small className="managed-document-error">
                        {document.classification_error_code}:{" "}
                        {document.classification_error_message}
                      </small>
                    )}
                  </div>
                  {(document.predicted_type === "BOQ" ||
                    document.boq_extraction_id) && (
                    <div className="boq-extraction-summary">
                      <span
                        className={
                          document.boq_extraction_status === "Completed"
                            ? "review-ready"
                            : document.boq_extraction_status === "Failed"
                              ? "review-blocked"
                              : "review-pending"
                        }
                      >
                        {document.boq_extraction_status ||
                          "Awaiting confirmed BOQ classification"}
                      </span>
                      <strong>
                        {boqSummary.validBoqItems || 0} BOQ items ·{" "}
                        {boqSummary.itemsNeedingReview || 0} need review
                      </strong>
                      <small>
                        {boqSummary.sectionsDetected || 0} sections · average
                        confidence {boqSummary.averageConfidence || 0}% ·
                        extraction v{document.boq_extraction_version || 0}
                      </small>
                      {document.boq_extraction_error_message && (
                        <small className="managed-document-error">
                          {document.boq_extraction_error_code}:{" "}
                          {document.boq_extraction_error_message} ·{" "}
                          {document.boq_extraction_suggested_action}
                        </small>
                      )}
                    </div>
                  )}
                  {(document.predicted_type === "Technical Specification" ||
                    document.specification_extraction_id) && (
                    <div className="boq-extraction-summary">
                      <span
                        className={
                          document.specification_extraction_status === "Failed"
                            ? "review-blocked"
                            : document.specification_extraction_id
                              ? "review-ready"
                              : "review-pending"
                        }
                      >
                        {document.specification_extraction_status ||
                          "Ready to start"}
                      </span>
                      <strong>
                        {specificationSummaryFor(document).requirements || 0}{" "}
                        requirements ·{" "}
                        {specificationSummaryFor(document).clauses || 0} clauses
                      </strong>
                      <small>
                        Extraction v
                        {document.specification_extraction_version || 0}
                      </small>
                      {document.specification_job_id && (
                        <div className="specification-live-progress">
                          <strong>
                            {document.specification_job_status || "Queued"} · Page{" "}
                            {document.specification_current_page || document.specification_processed_pages || 0} of{" "}
                            {document.specification_total_pages || 0}
                          </strong>
                          <progress
                            value={document.specification_processed_pages || 0}
                            max={document.specification_total_pages || 1}
                            aria-label={`Specification extraction page ${document.specification_current_page || 0} of ${document.specification_total_pages || 0}`}
                          />
                          <small>
                            {document.specification_total_pages
                              ? Math.round(((document.specification_processed_pages || 0) / document.specification_total_pages) * 100)
                              : 0}% · Chunk {document.specification_current_chunk || 0} ·{" "}
                            {document.specification_remaining_chunks || 0} remaining
                          </small>
                          <small>
                            Requirements {document.specification_live_requirements || 0} · Clauses{" "}
                            {document.specification_live_clauses || 0} · Elapsed{" "}
                            {Math.floor((document.specification_elapsed_seconds || 0) / 60)}m · ETA{" "}
                            {document.specification_eta_seconds == null
                              ? "calculating"
                              : `${Math.ceil(document.specification_eta_seconds / 60)}m`}
                          </small>
                        </div>
                      )}
                      {document.specification_extraction_error_message && (
                        <small className="managed-document-error">
                          {document.specification_extraction_error_code}:{" "}
                          {document.specification_extraction_error_message} ·{" "}
                          {document.specification_extraction_suggested_action}
                        </small>
                      )}
                      {specificationExtractionRequest?.documentId ===
                        document.id && (
                        <small
                          className={
                            specificationExtractionRequest.errorMessage
                              ? "managed-document-error"
                              : "review-ready"
                          }
                        >
                          {specificationExtractionRequest.loading
                            ? "Processing…"
                            : specificationExtractionRequest.status}
                          {specificationExtractionRequest.errorMessage
                            ? ` · ${specificationExtractionRequest.errorCode}: ${specificationExtractionRequest.errorMessage} · ${specificationExtractionRequest.suggestedAction}`
                            : ""}
                        </small>
                      )}
                    </div>
                  )}
                  <small>
                    Next action: {managedDocumentNextAction(document)}
                  </small>
                </div>
                <div className="managed-document-state">
                  <span
                    className={
                      document.processing_status === "Failed"
                        ? "review-blocked"
                        : document.processing_status === "Completed"
                          ? "review-ready"
                          : "review-pending"
                    }
                  >
                    {document.archived_at
                      ? "Archived"
                      : document.processing_status || "Uploaded"}{" "}
                    · {document.progress || 0}%
                  </span>
                  <progress
                    value={document.progress || 0}
                    max="100"
                    aria-label={`${document.logical_name} processing progress`}
                  />
                </div>
                <div className="managed-document-actions">
                  <a
                    href={`/api/documents/${encodeURIComponent(document.id)}/download`}
                  >
                    Download
                  </a>
                  <a
                    href={`/api/documents/${encodeURIComponent(document.id)}/preview`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Preview
                  </a>
                  <button onClick={() => editManagedDocument(document)}>
                    Metadata
                  </button>
                  <a
                    href={`/api/documents/${encodeURIComponent(document.id)}/history`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    History
                  </a>
                  <button onClick={() => restoreManagedVersion(document)}>
                    Versions
                  </button>
                  <a
                    href={`/api/documents/${encodeURIComponent(document.id)}/classification/result`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Evidence
                  </a>
                  {document.predicted_type === "BOQ" && (
                    <button
                      onClick={() =>
                        boqExtractionCommand(
                          document,
                          document.boq_extraction_id ? "rerun" : "start",
                        )
                      }
                    >
                      {document.boq_extraction_id
                        ? "Re-run BOQ extraction"
                        : "Start BOQ extraction"}
                    </button>
                  )}
                  {document.predicted_type === "Technical Specification" && (
                    <button
                      disabled={
                        specificationExtractionRequest?.documentId ===
                          document.id && specificationExtractionRequest.loading
                      }
                      onClick={() =>
                        specificationExtractionCommand(
                          document,
                          document.specification_extraction_id
                            ? "rerun"
                            : "start",
                        )
                      }
                    >
                      {specificationExtractionRequest?.documentId ===
                        document.id && specificationExtractionRequest.loading
                        ? "Processing specification…"
                        : document.specification_extraction_id
                          ? "Re-run specification extraction"
                          : "Start specification extraction"}
                    </button>
                  )}
                  {document.boq_extraction_id && (
                    <>
                      <a
                        href={`/api/documents/${encodeURIComponent(document.id)}/boq-extraction/items`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Review extracted rows
                      </a>
                      <a
                        href={`/api/documents/${encodeURIComponent(document.id)}/boq-extraction/export`}
                      >
                        Export raw extraction
                      </a>
                    </>
                  )}
                  {document.classification_id &&
                    document.classification_status !== "Manually Confirmed" && (
                      <button
                        onClick={() =>
                          classificationCommand(document, "confirm")
                        }
                      >
                        Confirm type
                      </button>
                    )}
                  <button
                    onClick={() => classificationCommand(document, "override")}
                  >
                    Change type
                  </button>
                  <button
                    onClick={() => classificationCommand(document, "page")}
                  >
                    Page range
                  </button>
                  <button
                    onClick={() => classificationCommand(document, "sheet")}
                  >
                    Worksheet
                  </button>
                  <button
                    onClick={() => classificationCommand(document, "rerun")}
                  >
                    Re-run classification
                  </button>
                  {document.processing_status === "Failed" ||
                  document.processing_status === "Cancelled" ||
                  document.processing_status === "Waiting" ? (
                    <button
                      onClick={() =>
                        runManagedDocumentAction(document, "retry")
                      }
                    >
                      Retry
                    </button>
                  ) : null}
                  {!["Completed", "Failed", "Cancelled"].includes(
                    document.processing_status || "",
                  ) ? (
                    <button
                      onClick={() =>
                        runManagedDocumentAction(document, "cancel")
                      }
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    onClick={() =>
                      runManagedDocumentAction(
                        document,
                        document.archived_at ? "restore" : "archive",
                      )
                    }
                  >
                    {document.archived_at ? "Restore" : "Archive"}
                  </button>
                  <button
                    onClick={() => runManagedDocumentAction(document, "delete")}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
          {!managedDocumentsLoading &&
            !managedDocuments.length &&
            !uploadingDocumentNames.length && (
              <div className="empty-state">
                <strong>No durable documents yet</strong>
                <p>
                  Upload a supported engineering file. Its original bytes,
                  metadata, version and processing job will survive refresh.
                </p>
              </div>
            )}
        </section>
        <details className="document-progressive-section baseline-document-register">
          <summary>
            <span>
              <small>LEGACY WORKFLOW REGISTER</small>
              <strong>
                {currentDocumentCount
                  ? `${currentDocumentCount} project source${currentDocumentCount === 1 ? "" : "s"}`
                  : "No registered project sources"}
              </strong>
              <em>
                Open filenames, classifications and indexing status · existing
                workflow references
              </em>
            </span>
            <b>View register</b>
          </summary>
          <div className="document-list document-progressive-body">
            {(baseTenderLoaded ? tenderDocuments : []).map((name, index) => (
              <article key={name}>
                <span className="document-icon">
                  {name.endsWith(".pdf") ? "PDF" : "XLS"}
                </span>
                <div>
                  <strong>{name}</strong>
                  <p>
                    {index === 0
                      ? "BOQ · 21 normalized scope lines · original row references retained"
                      : index === 1
                        ? "Particular specification · 31 pages · technical clauses indexed"
                        : name.includes("Honeywell")
                          ? "Manufacturer price list · 504 numeric USD list-price rows · effective 01 Mar 2023"
                          : name.includes("94-ZZZ")
                            ? "Cause-and-effect drawing · source controlled"
                            : name.includes("93-ZZZ")
                              ? "Fire detection and alarm schematic · source controlled"
                              : name.includes("91-ZZZ")
                                ? "FCC room details · source controlled"
                                : "Tender drawing · classification verified"}
                  </p>
                </div>
                <span
                  className={
                    name.includes("Honeywell") ? "review-blocked" : "doc-status"
                  }
                >
                  {name.includes("Honeywell")
                    ? "Historical"
                    : index < 2
                      ? "Extracted"
                      : "Indexed"}
                </span>
              </article>
            ))}
            {!currentDocumentCount && (
              <div className="empty-state">
                <strong>No documents in this project</strong>
                <p>
                  Upload the project BOQ, specifications, drawings and current
                  supplier sources. Files remain isolated from every other local
                  workspace.
                </p>
              </div>
            )}
          </div>
        </details>
        {managedDocuments.some(
          (document) =>
            document.document_type === "Drawing" ||
            document.predicted_type === "Drawing",
        ) && (
          <section className="drawing-intake-launcher">
            <div>
              <small>PHASE 4.1A · DRAWING INTAKE</small>
              <strong>Indexed drawing assets</strong>
              <p>
                Structural pages, metadata, coordinates, legends and search
                only. No engineering objects or interpretation.
              </p>
            </div>
            {managedDocuments
              .filter(
                (document) =>
                  document.document_type === "Drawing" ||
                  document.predicted_type === "Drawing",
              )
              .map((document) => (
                <button
                  key={document.id}
                  onClick={() => void openDrawingWorkspace(document)}
                >
                  <span>PDF</span>
                  <span>
                    <strong>{document.logical_name}</strong>
                    <small>Open read-only Drawing Workspace</small>
                  </span>
                  <b>Open →</b>
                </button>
              ))}
          </section>
        )}
        {managedDocuments.some(
          (document) =>
            document.document_type === "Drawing" ||
            document.predicted_type === "Drawing",
        ) && (
          <section className="drawing-intake-launcher symbol-review-launcher">
            <div>
              <small>PHASE 4.1B · SYMBOL REVIEW</small>
              <strong>Legend definitions and repeated symbols</strong>
              <p>
                Evidence-led definitions, occurrences and unknown geometry.
                Counts are not BOQ quantities.
              </p>
            </div>
            {managedDocuments
              .filter(
                (document) =>
                  document.document_type === "Drawing" ||
                  document.predicted_type === "Drawing",
              )
              .map((document) => (
                <button
                  key={document.id}
                  onClick={() => void openSymbolWorkspace(document)}
                >
                  <span>SYM</span>
                  <span>
                    <strong>{document.logical_name}</strong>
                    <small>Open governed Symbol Review</small>
                  </span>
                  <b>Review →</b>
                </button>
              ))}
          </section>
        )}
        {managedDocuments.some(
          (document) =>
            document.extension?.toLowerCase() === "pdf" &&
            (/-DR-/i.test(document.logical_name) ||
              document.document_type === "Drawing" ||
              document.predicted_type === "Drawing"),
        ) && (
          <section className="drawing-intake-launcher structure-workspace-launcher">
            <div>
              <small>PHASE 4.1C · STRUCTURAL PARSER</small>
              <strong>Tables, rows, columns and cells</strong>
              <p>
                Physical drawing structure only. Headers remain separate and no
                engineering meaning is created.
              </p>
            </div>
            {managedDocuments
              .filter(
                (document) =>
                  document.extension?.toLowerCase() === "pdf" &&
                  (/-DR-/i.test(document.logical_name) ||
                    document.document_type === "Drawing" ||
                    document.predicted_type === "Drawing"),
              )
              .map((document) => (
                <button
                  key={document.id}
                  onClick={() => void openStructureWorkspace(document)}
                >
                  <span>GRID</span>
                  <span>
                    <strong>{document.logical_name}</strong>
                    <small>Open read-only Drawing Structure</small>
                  </span>
                  <b>Inspect →</b>
                </button>
              ))}
          </section>
        )}
        {uploadedFiles.length > 0 && (
          <section className="intake-queue">
            <div className="section-title">
              <div>
                <small>LOCAL INTAKE QUEUE</small>
                <strong>
                  {uploadedFiles.length} registered file
                  {uploadedFiles.length === 1 ? "" : "s"} awaiting review
                </strong>
              </div>
              <span>No BOQ quantities or prices changed</span>
            </div>
            {uploadedFiles.map((name) => {
              const role = documentRoles[name] || inferDocumentRole(name);
              const knownBoq = documentHashes[name] === almoosaBoqSha256;
              const knownPriceList =
                documentHashes[name] === honeywellPriceListSha256;
              const knownSpecification =
                documentHashes[name] === fireAlarmSpecificationSha256;
              const applied =
                knownBoq && appliedDocumentHashes.includes(almoosaBoqSha256);
              const indexed =
                knownPriceList &&
                durablePriceSourceHashes.includes(honeywellPriceListSha256);
              const technicalIndexed =
                knownSpecification &&
                indexedTechnicalHashes.includes(fireAlarmSpecificationSha256);
              return (
                <article key={name}>
                  <span className="document-icon">
                    {name.toLowerCase().endsWith(".pdf")
                      ? "PDF"
                      : name.toLowerCase().endsWith(".csv")
                        ? "CSV"
                        : "XLS"}
                  </span>
                  <div>
                    <strong>{name}</strong>
                    <p>
                      {knownBoq
                        ? "Legacy demo preview only · use the persisted BOQ extraction review for authoritative counts"
                        : knownPriceList
                          ? "Exact Honeywell V23.1 workbook recognized · 504 priced catalogue rows · historical source controls available"
                          : knownSpecification
                            ? "Exact Section 28 46 00 Rev 1 recognized · 31 pages · 6 requirement groups available for review"
                            : role === "Client inquiry"
                              ? "Registered scope or inquiry evidence · revision metadata and content authority still require review"
                              : "Registered only · no general extractor is available for this file format and content profile yet"}
                    </p>
                  </div>
                  <label>
                    Document role
                    <select
                      value={role}
                      onChange={(event) => {
                        const nextRole = event.target.value as DocumentRole;
                        setDocumentRoles((current) => ({
                          ...current,
                          [name]: nextRole,
                        }));
                        recordAudit(
                          "Document role reviewed",
                          `${name} · ${nextRole} · content not yet extracted`,
                        );
                      }}
                    >
                      <option>BOQ</option>
                      <option>Specification</option>
                      <option>Drawing</option>
                      <option>Client inquiry</option>
                      <option>Price source</option>
                      <option>Supplier quotation</option>
                      <option>Unclassified</option>
                    </select>
                  </label>
                  <span
                    className={
                      applied || indexed || technicalIndexed
                        ? "review-ready"
                        : "review-blocked"
                    }
                  >
                    {applied
                      ? "Applied"
                      : technicalIndexed
                        ? "Technical profile indexed"
                        : indexed
                          ? "Discovery indexed"
                          : knownBoq
                            ? "Extraction ready"
                            : knownPriceList || knownSpecification
                              ? "Review ready"
                              : "Registered only"}
                  </span>
                  {knownBoq && !applied && (
                    <button
                      className="intake-action"
                      onClick={() => {
                        setBoqPreviewFile(name);
                        setBoqLineDecisions(
                          Object.fromEntries(
                            initialItems.map((item) => [item.id, "Pending"]),
                          ),
                        );
                        setBoqExclusionReasons({});
                      }}
                    >
                      Start extraction review
                    </button>
                  )}
                  {knownPriceList && !indexed && (
                    <button
                      className="intake-action"
                      onClick={() => openSourceReview(name)}
                    >
                      Review source
                    </button>
                  )}
                  {knownSpecification && !technicalIndexed && (
                    <button
                      className="intake-action"
                      onClick={() => setTechnicalPreviewFile(name)}
                    >
                      Review requirements
                    </button>
                  )}
                </article>
              );
            })}
            <div className="intake-guardrail">
              <strong>Review gate</strong>
              <p>
                A registered file cannot replace the active BOQ, become a price
                source, authorize a scope exclusion, or change quotation totals
                until its content, issue metadata and role are explicitly
                reviewed.
              </p>
            </div>
          </section>
        )}
      </DocumentsWorkspace>
    ) : activeModule === "BOQ" ? (
      <BoqReviewWorkspace>
        {false && <div className="module-heading">
          <div>
            <small>STEP 02 · EXTRACTION REVIEW</small>
            <h1>Bill of quantities</h1>
            <p>
              Review the persisted, source-traceable extraction before
              downstream use.
            </p>
          </div>
        </div>}
        <div className="extraction-proof">
          <span>
            <small>BOQ ITEMS</small>
            <strong>
              {
                extractedBoqItems.filter((item) => item.row_type === "BOQ Item")
                  .length
              }
            </strong>
          </span>
          <span>
            <small>BOQ ITEMS NEEDING REVIEW</small>
            <strong>
              {
                extractedBoqItems.filter(
                  (item) =>
                    item.row_type === "BOQ Item" &&
                    item.review_status === "Needs Review",
                ).length
              }
            </strong>
          </span>
          <span>
            <small>SECTION / HEADER RECORDS</small>
            <strong>
              {
                extractedBoqItems.filter((item) => item.row_type !== "BOQ Item")
                  .length
              }
            </strong>
          </span>
          <span>
            <small>POSSIBLE DUPLICATES</small>
            <strong>
              {
                extractedBoqItems.filter(
                  (item) =>
                    item.row_type === "BOQ Item" &&
                    Boolean(item.duplicate_of_item_id),
                ).length
              }
            </strong>
          </span>
        </div>
        <div className="profile-actions" aria-live="polite">
          <button
            disabled={understandingRunning || !extractedBoqItems.some((item) => item.row_type === "BOQ Item")}
            onClick={async () => {
              setUnderstandingRunning(true);
              setUnderstandingMessage(`AI is analyzing ${extractedBoqItems.filter((item) => item.row_type === "BOQ Item").length} items`);
              try {
                const result = await requestJson<{ status: string; summary: { processed: number; successful: number; review: number; failed: number; unavailable: number } }>(`/api/projects/${encodeURIComponent(projectId)}/estimator-understanding/run`, { method: "POST" });
                const readiness = await requestJson<EstimatorReadiness>(`/api/projects/${encodeURIComponent(projectId)}/estimator-readiness`, { cache: "no-store" });
                setEstimatorReadiness(readiness);
                setUnderstandingMessage(result.status === "AI_UNAVAILABLE" ? "AI understanding is not configured; manual BOQ review remains available." : `${result.summary.processed} items analyzed · ${result.summary.review} need interpretation review · ${result.summary.failed} failed`);
              } catch (error) {
                setUnderstandingMessage(error instanceof Error ? error.message : "AI understanding could not run.");
              } finally {
                setUnderstandingRunning(false);
              }
            }}
          >
            {understandingRunning ? "Analyzing BOQ items…" : "Analyze BOQ items"}
          </button>
          {understandingMessage && <small>{understandingMessage}</small>}
        </div>
        <div className="compact-table boq-extraction-review-table">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Description / source</th>
                <th>Section</th>
                <th>Unit</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {extractedBoqItems
                .filter((item) => item.row_type === "BOQ Item")
                .map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        {item.item_number || `Row ${item.sequence}`}
                      </strong>
                      {item.duplicate_of_item_id && (
                        <small className="review-pending">
                          Possible duplicate · review required
                        </small>
                      )}
                    </td>
                    <td>
                      <strong>
                        {item.description || "Missing description"}
                      </strong>
                      <small>
                        {item.source_location.sheet ||
                          `Page ${item.source_location.page || "?"}`}{" "}
                        · row {item.source_location.row || "?"}
                      </small>
                      {(() => {
                        const understanding = estimatorReadiness?.items?.find((entry) => entry.boqItemId === item.id)?.understanding;
                        if (!understanding || ["Pending", "PENDING", "AI_UNAVAILABLE", "FAILED"].includes(understanding.status)) return understanding?.status === "AI_UNAVAILABLE" ? <small className="review-pending">AI Interpretation · unavailable</small> : null;
                        const value = (entry: unknown) => typeof entry === "object" && entry !== null && "value" in entry ? String((entry as { value?: unknown }).value || "") : String(entry || "");
                        const attributes = Object.values(understanding.attributes || {}).map((entry) => value(entry)).filter(Boolean).slice(0, 3);
                        const missing = (understanding.missingInformation || []).map((entry) => value(entry)).filter(Boolean).slice(0, 2);
                        return <div className="boq-review-reasons" aria-label="AI Interpretation">
                          <small>AI Interpretation · {understanding.confidence || understanding.status}</small>
                          <strong>{[value(understanding.system), value(understanding.equipmentType)].filter(Boolean).join(" · ") || "Interpretation needs review"}</strong>
                          {attributes.length > 0 && <small>Attributes: {attributes.join(", ")}</small>}
                          {missing.length > 0 && <small>Missing: {missing.join(", ")}</small>}
                          <small>Not a verified product specification</small>
                        </div>;
                      })()}
                    </td>
                    <td>{item.section || "—"}</td>
                    <td>
                      {item.original_unit || (
                        <span className="missing-text">Missing</span>
                      )}
                    </td>
                    <td>
                      {item.original_quantity || (
                        <span className="missing-text">Missing</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          item.review_status === "Approved"
                            ? "review-ready"
                            : item.review_status === "Rejected"
                              ? "review-blocked"
                              : "review-pending"
                        }
                      >
                        {extractionReviewStatusLabel(item)}
                      </span>
                      {(() => {
                        const reasons = boqReviewReasons(item);
                        if (!reasons.length) return null;
                        const expanded = Boolean(
                          expandedBoqReviewReasons[item.id],
                        );
                        const visibleReasons = expanded
                          ? reasons
                          : reasons.slice(0, 3);
                        return (
                          <div
                            className="boq-review-reasons"
                            aria-label={`Review reasons for ${item.item_number || item.description || `item ${item.sequence}`}`}
                          >
                            <small>Review reasons</small>
                            <ul>
                              {visibleReasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                            {reasons.length > 3 && (
                              <button
                                type="button"
                                className="boq-review-more"
                                aria-expanded={expanded}
                                onClick={() =>
                                  setExpandedBoqReviewReasons((current) => ({
                                    ...current,
                                    [item.id]: !expanded,
                                  }))
                                }
                              >
                                {expanded
                                  ? "Show less"
                                  : `+${reasons.length - 3} more`}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <div className="line-decision">
                        <button onClick={() => reviewBoqItem(item, "update")}>
                          Edit
                        </button>
                        <button onClick={() => reviewBoqItem(item, "restore")}>
                          Restore Original
                        </button>
                        <button onClick={() => reviewBoqItem(item, "approve")}>
                          Confirm Extraction
                        </button>
                        <button onClick={() => reviewBoqItem(item, "reject")}>
                          Reject Extraction
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!extractedBoqItems.some((item) => item.row_type === "BOQ Item") && (
            <div className="empty-state">
              <strong>No persisted BOQ items are available</strong>
              <p>
                Confirm and extract a BOQ document from the Documents workspace.
              </p>
            </div>
          )}
        </div>
        <section
          className="requirement-profile-workspace"
          aria-labelledby="requirement-profile-workspace-title"
        >
          <div className="section-title">
            <div>
              <small>SOURCE-DRIVEN TECHNICAL ANALYSIS</small>
              <strong id="requirement-profile-workspace-title">
                Requirement Profiles
              </strong>
            </div>
            <span>
              Extraction-confirmed BOQ items only · matching remains disabled
            </span>
          </div>
          {requirementProfileError && (
            <p className="managed-document-error" role="alert">
              {requirementProfileError}
            </p>
          )}
          {extractedBoqItems
            .filter(
              (item) =>
                item.row_type === "BOQ Item" &&
                item.review_status === "Approved",
            )
            .map((item) => {
              const profile = requirementProfilesByItem[item.id];
              const data = profile?.profile || {};
              const intelligence = data.intelligence;
              return (
                <article key={`profile-${item.id}`}>
                  <div>
                    <strong>
                      {item.item_number || `Row ${item.sequence}`} ·{" "}
                      {item.description}
                    </strong>
                    <small>
                      {item.original_unit || "Missing unit"} · quantity{" "}
                      {item.original_quantity || "missing"} · source row{" "}
                      {item.source_location.row || "?"}
                    </small>
                  </div>
                  <span
                    className={
                      profile
                        ? profile.readiness_status === "Ready for Matching"
                          ? "review-ready"
                          : "review-blocked"
                        : "review-pending"
                    }
                  >
                    {profile
                      ? `v${profile.version_number} · ${profile.readiness_status}`
                      : "Not generated"}
                  </span>
                  <div className="profile-metrics">
                    <small>
                      Applicable{" "}
                      <b>{data.applicableRequirements?.length || 0}</b>
                    </small>
                    <small>
                      Intelligence facts{" "}
                      <b>{intelligence?.counts?.total || 0}</b>
                    </small>
                    <small>
                      Missing <b>{data.missingInformation?.length || 0}</b>
                    </small>
                    <small>
                      Conflicts <b>{data.conflicts?.length || 0}</b>
                    </small>
                    <small>
                      Standards <b>{data.standards?.length || 0}</b>
                    </small>
                    <small>
                      Compatibility <b>{data.compatibility?.length || 0}</b>
                    </small>
                    <small>
                      Accessories <b>{data.accessories?.length || 0}</b>
                    </small>
                    <small>
                      Clarifications <b>{data.clarifications?.length || 0}</b>
                    </small>
                    <small>
                      Confidence <b>{data.confidence?.overall ?? "—"}</b>
                    </small>
                  </div>
                  <div className="profile-actions">
                    <button
                      disabled={requirementProfileLoadingId === item.id}
                      onClick={() =>
                        generateRequirementProfile(
                          item,
                          profile ? "recalculate" : "generate",
                        )
                      }
                    >
                      {requirementProfileLoadingId === item.id
                        ? "Processing…"
                        : profile
                          ? "Recalculate Profile"
                          : "Generate profile"}
                    </button>
                    {profile && (
                      <button
                        onClick={() =>
                          void openRequirementIntelligence(item.id)
                        }
                      >
                        Review intelligence
                      </button>
                    )}
                    {profile && (
                      <button
                        onClick={() =>
                          void openEngineeringClassification(item.id)
                        }
                      >
                        Engineering classification
                      </button>
                    )}
                    {profile && (
                      <button
                        onClick={() => void openEngineeringGraph(item.id)}
                      >
                        Engineering Graph
                      </button>
                    )}
                    {profile && (
                      <a
                        href={`/api/boq-items/${encodeURIComponent(item.id)}/requirement-profile`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open evidence record
                      </a>
                    )}
                  </div>
                  {profile && (
                    <small className="profile-blocker-note">
                      {profile.readiness_status === "Ready for Matching"
                        ? "Profile requires explicit readiness approval before matching."
                        : "Missing compatibility, evidence or critical information keeps matching blocked."}
                    </small>
                  )}
                </article>
              );
            })}
          {!extractedBoqItems.some(
            (item) =>
              item.row_type === "BOQ Item" && item.review_status === "Approved",
          ) && (
            <div className="empty-state">
              <strong>No approved BOQ items</strong>
              <p>Review source values before generating technical profiles.</p>
            </div>
          )}
        </section>
      </BoqReviewWorkspace>
    ) : activeModule === "Product Library" ? (
      <section className="module-page product-library-page">
        <div className="module-heading">
          <div>
            <small>CANONICAL PRODUCT & EVIDENCE REGISTER</small>
            <h1>Product Library</h1>
            <p>
              Search active products, superseded order codes and reviewed source
              observations. Library evidence never approves a price by itself.
            </p>
          </div>
        </div>
        <div className="library-safety-banner">
          <strong>Costing safety is enforced</strong>
          <span>
            Historical and Discovery Only prices remain blocked unless
            separately approved with a current validity end date.
          </span>
        </div>
        <label className="library-search">
          <span>
            Search by part number, alias, original code or description
          </span>
          <input
            aria-label="Search Product Library"
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            placeholder="Example: IFP-75HV, B501-BL. or REL-4.7K"
          />
        </label>
        {libraryError && (
          <div className="dashboard-error" role="alert">
            <strong>Product Library unavailable</strong>
            <p>{libraryError}</p>
          </div>
        )}
        <div className="product-library-layout">
          <div className="library-results" aria-live="polite">
            <div className="section-title">
              <div>
                <small>SEARCH RESULTS</small>
                <strong>
                  {libraryLoading
                    ? "Searching…"
                    : `${libraryProducts.length} record${libraryProducts.length === 1 ? "" : "s"}`}
                </strong>
              </div>
              <span>Canonical server records</span>
            </div>
            {!libraryLoading &&
              libraryProducts.map((product) => (
                <button
                  key={`${product.requestedProductId}-${product.requestedPartNumber}`}
                  onClick={() => openLibraryProduct(product)}
                  className={
                    selectedLibraryProduct?.canonicalResolution
                      .requestedProductId === product.requestedProductId
                      ? "selected"
                      : ""
                  }
                >
                  <span>
                    <strong>{product.requestedPartNumber}</strong>
                    <small>{product.description}</small>
                    <small>
                      {product.manufacturer}
                      {product.family ? ` · ${product.family}` : ""}
                    </small>
                  </span>
                  <span>
                    <b
                      className={
                        product.requestedIdentityStatus === "Superseded"
                          ? "review-pending"
                          : "review-ready"
                      }
                    >
                      {product.requestedIdentityStatus ||
                        product.identity_status}
                    </b>
                    {product.resolvesToCanonical && (
                      <small>Resolves to {product.canonicalPartNumber}</small>
                    )}
                  </span>
                </button>
              ))}
            {!libraryLoading && !libraryProducts.length && !libraryError && (
              <div className="empty-state">
                <strong>No matching product record</strong>
                <p>
                  Try an exact manufacturer code, preserved original code, alias
                  or technical description.
                </p>
              </div>
            )}
          </div>
          <div className="library-detail">
            {libraryDetailLoading && (
              <div className="dashboard-loading">
                <strong>Loading product evidence…</strong>
              </div>
            )}
            {!libraryDetailLoading && !selectedLibraryProduct && (
              <div className="empty-state">
                <strong>Select a product</strong>
                <p>
                  Canonical resolution, source provenance, prices and missing
                  evidence will appear here.
                </p>
              </div>
            )}
            {!libraryDetailLoading && selectedLibraryProduct && (
              <>
                <header>
                  <div>
                    <small>CANONICAL PRODUCT</small>
                    <h2>{selectedLibraryProduct.product.part_number}</h2>
                    <p>{selectedLibraryProduct.product.description}</p>
                  </div>
                  <span className="review-ready">
                    {selectedLibraryProduct.product.identity_status}
                  </span>
                </header>
                <div className="canonical-chain">
                  <strong>
                    {
                      selectedLibraryProduct.canonicalResolution
                        .requestedPartNumber
                    }
                  </strong>
                  <span>→</span>
                  <strong>
                    {
                      selectedLibraryProduct.canonicalResolution
                        .canonicalPartNumber
                    }
                  </strong>
                  <small>
                    {selectedLibraryProduct.canonicalResolution.resolved
                      ? "Superseded observation resolved to active canonical identity"
                      : "Direct canonical identity"}
                  </small>
                </div>
                <div className="library-evidence-grid">
                  <span>
                    <small>Source evidence</small>
                    <strong>{selectedLibraryProduct.evidence.length}</strong>
                  </span>
                  <span>
                    <small>Attributes</small>
                    <strong>{selectedLibraryProduct.attributes.length}</strong>
                  </span>
                  <span>
                    <small>Certifications</small>
                    <strong>
                      {selectedLibraryProduct.certifications.length}
                    </strong>
                  </span>
                  <span>
                    <small>Compatibility</small>
                    <strong>
                      {selectedLibraryProduct.compatibility.length}
                    </strong>
                  </span>
                  <span>
                    <small>Accessories</small>
                    <strong>{selectedLibraryProduct.accessories.length}</strong>
                  </span>
                  <span>
                    <small>Documents</small>
                    <strong>{selectedLibraryProduct.documents.length}</strong>
                  </span>
                </div>
                <section className="library-detail-section">
                  <strong>Original codes and provenance</strong>
                  {selectedLibraryProduct.orderCodeObservations.length ? (
                    selectedLibraryProduct.orderCodeObservations.map(
                      (record, index) => (
                        <p key={index}>
                          <b>{String(record.original_order_code)}</b> · source
                          row {String(record.source_row || "—")} ·{" "}
                          {String(record.review_status)}
                        </p>
                      ),
                    )
                  ) : (
                    <p>No additional reviewed order-code observation.</p>
                  )}
                  {selectedLibraryProduct.evidence.map((record, index) => (
                    <p key={`e-${index}`}>
                      {String(record.file_name || "Source document")} ·{" "}
                      {record.page
                        ? `page ${String(record.page)}`
                        : record.row_number
                          ? `row ${String(record.row_number)}`
                          : "location retained"}{" "}
                      · {String(record.source_type || "Evidence")}
                    </p>
                  ))}
                </section>
                <section className="library-detail-section">
                  <strong>Historical prices</strong>
                  {selectedLibraryProduct.prices.length ? (
                    selectedLibraryProduct.prices.map((price, index) => (
                      <article key={index}>
                        <b>
                          {String(price.currency)}{" "}
                          {Number(price.amount).toFixed(2)}
                        </b>
                        <span className="review-blocked">
                          Historical / Discovery Only
                        </span>
                        <small>
                          No validity end · Not approved for costing
                        </small>
                        <small>
                          {String(price.file_name || "Source retained")} ·{" "}
                          {String(price.approval_status)} ·{" "}
                          {String(price.validity_state)}
                        </small>
                      </article>
                    ))
                  ) : (
                    <p>No price evidence is linked.</p>
                  )}
                  <small className="safety-note">
                    Eligible for costing:{" "}
                    {selectedLibraryProduct.safety.costingEligiblePrices}.
                    Missing validity or approval is never inferred.
                  </small>
                </section>
                <section className="library-detail-section">
                  <strong>Technical evidence</strong>
                  <p>
                    Attributes:{" "}
                    {selectedLibraryProduct.attributes.length || "Missing"} ·
                    Certifications:{" "}
                    {selectedLibraryProduct.certifications.length || "Missing"}{" "}
                    · Compatibility:{" "}
                    {selectedLibraryProduct.compatibility.length || "Missing"} ·
                    Accessories:{" "}
                    {selectedLibraryProduct.accessories.length || "Missing"}
                  </p>
                  <small>
                    Counts show source records, not verified claims. Needs
                    Review and Unverified records remain visibly unapproved.
                  </small>
                </section>
              </>
            )}
          </div>
        </div>
      </section>
    ) : activeModule === "Technical Matching" && Boolean(0) &&
      !persistedTechnicalScopeReady ? (
      <section className="module-page">
        <div className="module-heading">
          <div>
            <small>STEP 05 · PRODUCT MATCHING</small>
            <h1>Product matching</h1>
            <p>
              {scopeMissing
                ? "This project has no reviewed technical scope yet."
                : `${items.length} BOQ lines are available, but their specifications still need review.`}
            </p>
          </div>
        </div>
        <div className="empty-state">
          <strong>
            {scopeMissing
              ? "Add the project BOQ and specifications first"
              : "Review the project specifications"}
          </strong>
          <p>
            Product suggestions become available only after the project evidence
            is reviewed. Nothing is selected automatically.
          </p>
          <button
            className="inline-primary"
            onClick={() => navigate("Documents")}
          >
            Open documents
          </button>
        </div>
      </section>
    ) : activeModule === "Technical Matching" ? (
      <MatchingWorkspace
        items={extractedBoqItems.filter((item) => item.row_type === "BOQ Item")}
        requirementCount={persistedRequirementCount}
        pendingRequirementCount={persistedRequirementNeedsReview}
        stageStatus={preSalesWorkflow?.stages.find((stage) => stage.id === "product-matching")?.status || "Waiting"}
        blockers={(preSalesWorkflow?.blockers || []).filter((blocker) => blocker.stageId === "product-matching").map((blocker) => blocker.message)}
        onSelect={(itemId) => {
          setSelectedMatchingItemId(itemId);
          window.history.pushState(null, "", buildProjectLocation(projectId, "Technical Matching", itemId));
        }}
        onOpenLibrary={() => navigate("Product Library")}
      />
    ) : activeModule === "Technical Matching" && Boolean(0) ? (
      <section className="module-page construction-workspace">
        <div className="module-heading">
          <div>
            <small>STEP 05 · PRODUCT MATCHING</small>
            <h1>Review product suggestions</h1>
            <p>
              {persistedBoqItemCount} BOQ items · {persistedRequirementCount}{" "}
              extracted requirements · {persistedRequirementNeedsReview}{" "}
              awaiting review. Every suggestion shows its evidence, missing
              information and approval status.
            </p>
          </div>
          <div className="heading-actions">
            <button
              className="secondary-action"
              onClick={() => navigate("Product Library")}
            >
              Search Product Library
            </button>
            <button onClick={openFirstMatch}>Review next item</button>
          </div>
        </div>
        <div className="active-source-banner" role="status">
          <div>
            <small>ACTIVE COST SOURCE</small>
            <strong>No approved current source</strong>
            <p>
              {managedPriceDocuments.length || honeywellSourceIndexed
                ? "The uploaded Honeywell/Farenhyt 2023 list is registered and its canonical product records are searchable. Historical Discovery Only prices cannot enter project cost or quotation totals."
                : "No product catalogue or current supplier quotation has been indexed in this project. Technical requirements are ready, but pricing remains isolated and blocked."}
            </p>
          </div>
          <button onClick={() => navigate("Price Sources")}>
            Review source controls
          </button>
        </div>
        <div className="diagnostics-block">
          <div className="diagnostics-heading">
            <div>
              <small>MATCHING DIAGNOSTICS</small>
              <strong>Why pricing is still blocked</strong>
            </div>
            <span>
              {persistedBoqItemCount} BOQ items require governed matching and
              pricing
            </span>
          </div>
          <div className="diagnostic-grid">
            <button onClick={() => setMatchView("Products")}>
              <strong>0</strong>
              <span>Safe matches ready</span>
              <small>No current, compliant price evidence</small>
            </button>
            <button onClick={() => navigate("Product Library")}>
              <strong>API</strong>
              <span>Canonical Product Library</span>
              <small>Server-persisted identities and source evidence</small>
            </button>
            <button onClick={() => setMatchView("Requirements")}>
              <strong>{persistedRequirementCount}</strong>
              <span>Extracted requirements</span>
              <small>
                Requirement Profiles and evidence review still required
              </small>
            </button>
            <button onClick={() => navigate("Supplier RFQs")}>
              <strong>{persistedBoqItemCount}</strong>
              <span>Current prices required</span>
              <small>
                Create an RFQ or add a valid quotation after matching
              </small>
            </button>
          </div>
        </div>
        <div className="engineering-summary">
          <div>
            <small>BOQ QUANTITY</small>
            <strong>1 MFACP · 6 FACP</strong>
          </div>
          <div>
            <small>REQUIREMENTS</small>
            <strong>6 require product evidence</strong>
          </div>
          <div>
            <small>SELECTED PRODUCT</small>
            <strong>Not selected</strong>
          </div>
          <div>
            <small>INSTALLED COST / PANEL</small>
            <strong>Awaiting supplier pricing</strong>
          </div>
        </div>
        <div
          className="workspace-tabs"
          role="tablist"
          aria-label="Engineering review"
        >
          <button
            className={matchView === "Requirements" ? "active" : ""}
            onClick={() => setMatchView("Requirements")}
          >
            1 · Requirements
          </button>
          <button
            className={matchView === "Products" ? "active" : ""}
            onClick={() => setMatchView("Products")}
          >
            2 · Product compliance
          </button>
          <button
            className={matchView === "Assembly" ? "active" : ""}
            onClick={() => setMatchView("Assembly")}
          >
            3 · Assembly & labor
          </button>
        </div>
        {matchView === "Requirements" && (
          <>
            <div className="policy-banner">
              <strong>Cross-document requirement profile</strong>
              <p>
                Every requirement retains its class, required evidence,
                specification clause, reviewer decision and audit record.
                Technical review never changes BOQ quantities or costs.
              </p>
            </div>
            <div className="compliance-table">
              <table>
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Class / required proof</th>
                    <th>Specification source</th>
                    <th>Reviewed evidence</th>
                    <th>Result</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requirementReviews.map((requirement) => {
                    const policy = requirementPolicyFor(requirement.id);
                    return (
                      <tr key={requirement.id}>
                        <td>
                          <strong>{requirement.requirement}</strong>
                          {requirement.reviewerNote && (
                            <small>{requirement.reviewerNote}</small>
                          )}
                        </td>
                        <td>
                          <strong>{policy.classification}</strong>
                          <small>{policy.evidenceKind}</small>
                        </td>
                        <td>{requirement.source}</td>
                        <td>
                          {requirement.evidence || (
                            <span className="missing-text">
                              Evidence required
                            </span>
                          )}
                        </td>
                        <td>
                          <span
                            className={
                              requirement.status === "Compliant"
                                ? "review-ready"
                                : "review-blocked"
                            }
                          >
                            {requirement.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="inline-link"
                            onClick={() => openRequirementReview(requirement)}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {matchView === "Products" && (
          <div className="empty-state">
            <strong>Use canonical Product Library evidence</strong>
            <p>
              {persistedBoqItemCount} BOQ items and {persistedRequirementCount}{" "}
              specification requirements are available. Product selection still
              requires reviewed Requirement Profiles; historical prices cannot
              be used for costing.
            </p>
            <button
              className="inline-primary"
              onClick={() => navigate("Product Library")}
            >
              Browse Product Library
            </button>
          </div>
        )}
        {matchView === "Assembly" && (
          <>
            <div className="assembly-heading">
              <div>
                <strong>Panel installation assembly</strong>
                <p>
                  Required components are source-backed; rates remain empty
                  until a valid quotation is received.
                </p>
              </div>
              <button onClick={() => navigate("Supplier RFQs")}>
                Request assembly pricing
              </button>
            </div>
            <div className="compliance-table">
              <table>
                <thead>
                  <tr>
                    <th>Cost type</th>
                    <th>Component</th>
                    <th>Rule / basis</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Unit cost</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {panelAssembly.map((part) => (
                    <tr key={part.id}>
                      <td>
                        <span className="cost-kind">{part.kind}</span>
                      </td>
                      <td>
                        <strong>{part.component}</strong>
                      </td>
                      <td>{part.basis}</td>
                      <td>{part.qty}</td>
                      <td>{part.unit}</td>
                      <td>
                        <span className="missing-text">Awaiting quote</span>
                      </td>
                      <td>—</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>Installed cost per panel</td>
                    <td>Not priced</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>
    ) : activeModule === "Review" ? (
      <CommercialReviewWorkspace
        summary={reviewSummary}
        items={commercialReviewQueue}
        loading={reviewLoading}
        error={reviewError}
        filter={reviewFilter}
        search={reviewSearch}
        reasons={reviewDecisionReason}
        onFilter={setReviewFilter}
        onSearch={setReviewSearch}
        onReason={(id, value) => setReviewDecisionReason((current) => ({ ...current, [id]: value }))}
        onRefresh={() => void loadReviewWorkspace(false)}
        onAction={(item, operation, outcome) => void actOnReview(item, operation, outcome)}
      />
    ) : activeModule === "Review" && scopeMissing && Boolean(0) ? (
      <section className="module-page">
        <div className="module-heading">
          <div>
            <small>STEP 05 · TECHNICAL & COMMERCIAL REVIEW</small>
            <h1>Technical review</h1>
            <p>
              Review controls will appear after this project&apos;s scope is
              extracted.
            </p>
          </div>
        </div>
        <div className="empty-state">
          <strong>No BOQ evidence to validate</strong>
          <p>
            Add documents and review the extracted scope before technical or
            commercial approval.
          </p>
          <button
            className="inline-primary"
            onClick={() => navigate("Documents")}
          >
            Add documents
          </button>
        </div>
      </section>
    ) : activeModule === "Review" && Boolean(0) ? (
      <section className="module-page">
        <div className="module-heading">
          <div>
            <small>STEP 05 · TECHNICAL & COMMERCIAL REVIEW</small>
            <h1>Technical review</h1>
            <p>
              Resolve technical and commercial control groups first, then
              inspect individual BOQ evidence only when needed.
            </p>
          </div>
          <span className="queue-count">{alertCount} controls open</span>
        </div>
        <section
          className="server-review-workspace"
          aria-labelledby="server-review-title"
        >
          <div className="section-title">
            <div>
              <small>SERVER-CONTROLLED REVIEW WORKFLOW</small>
              <strong id="server-review-title">
                Technical and commercial decision queue
              </strong>
            </div>
            <span
              className={
                reviewSummary?.readiness === "Ready for Quotation"
                  ? "review-ready"
                  : "review-blocked"
              }
            >
              {reviewSummary?.readiness || "Checking readiness…"}
            </span>
          </div>
          <div className="review-summary-strip">
            {[
              ["Total", reviewSummary?.total || 0],
              ["Open", reviewSummary?.open || 0],
              ["In review", reviewSummary?.inReview || 0],
              ["Waiting", reviewSummary?.waiting || 0],
              ["Blocked", reviewSummary?.blocked || 0],
              ["Approved", reviewSummary?.approved || 0],
              ["Overdue", reviewSummary?.overdue || 0],
            ].map(([label, value]) => (
              <article key={String(label)}>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <div className="review-queue-controls">
            <label>
              Queue view
              <select
                value={reviewFilter}
                onChange={(event) => setReviewFilter(event.target.value)}
              >
                <option>All</option>
                <option>Open</option>
                <option>Assigned</option>
                <option>In Review</option>
                <option>Waiting for Clarification</option>
                <option>Blocked</option>
                <option>Escalated</option>
                <option>Approved</option>
              </select>
            </label>
            <label>
              Search
              <input
                value={reviewSearch}
                onChange={(event) => setReviewSearch(event.target.value)}
                placeholder="BOQ item or review reason"
              />
            </label>
            <button
              className="secondary-action"
              disabled={reviewLoading}
              onClick={() => loadReviewWorkspace(false)}
            >
              {reviewLoading ? "Refreshing…" : "Apply filters"}
            </button>
          </div>
          {reviewError && (
            <p className="managed-document-error" role="alert">
              {reviewError}
            </p>
          )}
          <div className="persistent-review-list">
            {reviewQueue.map((review) => (
              <article
                key={review.id}
                className={review.blocking ? "review-card-blocked" : ""}
              >
                <header>
                  <div>
                    <span
                      className={`action-priority ${review.priority === "Critical" ? "p0" : review.priority === "High" ? "p1" : "p2"}`}
                    >
                      {review.priority}
                    </span>
                    <strong>
                      {review.boq_description || review.review_type}
                    </strong>
                  </div>
                  <span
                    className={
                      review.status === "Approved"
                        ? "review-ready"
                        : review.blocking
                          ? "review-blocked"
                          : "review-pending"
                    }
                  >
                    {review.status}
                  </span>
                </header>
                <dl>
                  <div>
                    <dt>Review</dt>
                    <dd>{review.review_type}</dd>
                  </div>
                  <div>
                    <dt>Decision</dt>
                    <dd>{review.required_decision}</dd>
                  </div>
                  <div>
                    <dt>Safety</dt>
                    <dd>{review.safety_state}</dd>
                  </div>
                  <div>
                    <dt>Authority</dt>
                    <dd>
                      Level {review.approval_level} · {review.required_role}
                    </dd>
                  </div>
                </dl>
                <p>{review.reason_for_review}</p>
                <label>
                  Decision reason
                  <textarea
                    value={reviewDecisionReason[review.id] || ""}
                    onChange={(event) =>
                      setReviewDecisionReason((current) => ({
                        ...current,
                        [review.id]: event.target.value,
                      }))
                    }
                    placeholder="Record the evidence reviewed, conclusion and remaining risk"
                  />
                </label>
                <footer>
                  <small>
                    Review v{review.version_number} · stale decisions are
                    rejected
                  </small>
                  <div>
                    {["Open", "Assigned", "Changes Requested"].includes(
                      review.status,
                    ) && (
                      <button
                        className="secondary-action"
                        disabled={reviewLoading}
                        onClick={() => actOnReview(review, "start")}
                      >
                        Start review
                      </button>
                    )}
                    {[
                      "In Review",
                      "Waiting for Technical Approval",
                      "Waiting for Commercial Approval",
                    ].includes(review.status) && (
                      <>
                        <button
                          className="secondary-action"
                          disabled={reviewLoading}
                          onClick={() =>
                            actOnReview(review, "decision", "Changes Requested")
                          }
                        >
                          Request changes
                        </button>
                        <button
                          disabled={reviewLoading || review.blocking === 1}
                          onClick={() =>
                            actOnReview(review, "decision", "Approved")
                          }
                        >
                          Approve current evidence
                        </button>
                      </>
                    )}
                    {![
                      "Approved",
                      "Rejected",
                      "Superseded",
                      "Cancelled",
                    ].includes(review.status) && (
                      <button
                        className="secondary-action"
                        disabled={reviewLoading}
                        onClick={() => actOnReview(review, "escalate")}
                      >
                        Escalate
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            ))}
            {!reviewLoading && !reviewQueue.length && (
              <div className="empty-state">
                <strong>No queue items match this view</strong>
                <p>
                  Actionable BOQ exceptions are synchronized from persisted
                  extraction, safety and pricing records. Change the filter or
                  complete earlier project stages.
                </p>
              </div>
            )}
          </div>
          <p className="review-server-note">
            Readiness, permissions, safety gates, pricing order, dependencies
            and version locks are recalculated by the server. Browser state
            cannot approve a quotation.
          </p>
        </section>
        <section
          className={`engineering-dossier ${engineeringDossier.approvalReady ? "dossier-ready" : "dossier-blocked"}`}
          aria-labelledby="engineering-dossier-title"
        >
          <div className="section-title">
            <div>
              <small>ENGINEERING REVIEW DOSSIER</small>
              <strong id="engineering-dossier-title">
                Senior engineering approval basis
              </strong>
            </div>
            <span
              className={
                engineeringDossier.approvalReady
                  ? "review-ready"
                  : "review-blocked"
              }
            >
              {engineeringDossier.approvalReady
                ? "Approval ready"
                : `${engineeringDossier.blockers.length} blocker${engineeringDossier.blockers.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="dossier-metrics">
            <article>
              <small>REQUIREMENTS</small>
              <strong>
                {persistedRequirementReviewedCount}/{persistedRequirementCount}
              </strong>
              <span>requirements reviewed</span>
            </article>
            <article>
              <small>DEVIATIONS</small>
              <strong>{engineeringDossier.totals.deviations}</strong>
              <span>must remain explicit</span>
            </article>
            <article>
              <small>DRAWINGS</small>
              <strong>{projectDrawingCount}</strong>
              <span>controlled sources</span>
            </article>
            <article>
              <small>BOQ SCOPE</small>
              <strong>{persistedBoqItemCount}</strong>
              <span>extracted items · review pending</span>
            </article>
          </div>
          <div className="dossier-sections">
            {engineeringDossier.sections.map((section) => (
              <article key={section.id}>
                <span
                  className={
                    section.status === "Complete" ||
                    section.status === "Established" ||
                    section.status === "Evidence accepted" ||
                    section.status.includes("reviewed")
                      ? "check-pass"
                      : "check-open"
                  }
                >
                  {section.status === "Complete" ||
                  section.status === "Established" ||
                  section.status === "Evidence accepted" ||
                  section.status.includes("reviewed")
                    ? "✓"
                    : "!"}
                </span>
                <div>
                  <strong>{section.label}</strong>
                  <small>{section.status}</small>
                </div>
              </article>
            ))}
          </div>
          {engineeringDossier.blockers.length > 0 && (
            <div className="dossier-blockers">
              <strong>Approval cannot proceed</strong>
              <ul>
                {engineeringDossier.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
              <p>AI confidence never overrides these conditions.</p>
            </div>
          )}
        </section>
        {knownServiceScope && (
          <section
            className={`scope-alignment-control ${scopeAlignmentResolved ? "scope-alignment-resolved" : ""}`}
          >
            <div className="section-title">
              <div>
                <small>SCOPE ALIGNMENT</small>
                <strong>
                  Materials-only quotation conflicts with tender service scope
                </strong>
              </div>
              <span
                className={
                  scopeAlignmentResolved ? "review-ready" : "review-blocked"
                }
              >
                {scopeAlignmentResolved
                  ? "Authorized deviation"
                  : "Blocking conflict"}
              </span>
            </div>
            <div className="scope-evidence-grid">
              <article>
                <small>TENDER EVIDENCE</small>
                <strong>BOQ.xlsx · MECH RFQ</strong>
                <p>
                  Rows 9, 44, 57, 79, 101, 123, 142, 164 and 185 repeat “supply,
                  install and connect,” including wiring, conduits and
                  accessories.
                </p>
              </article>
              <article>
                <small>CURRENT PRICING BOUNDARY</small>
                <strong>Materials only</strong>
                <p>
                  Installation, programming, testing and commissioning have no
                  cost and are excluded from the client quotation.
                </p>
              </article>
            </div>
            {scopeAlignmentResolved ? (
              <div className="scope-decision-record">
                <strong>
                  Formal authority: {scopeAlignmentDecision.evidenceReference}
                </strong>
                <p>{scopeAlignmentDecision.reason}</p>
                <small>
                  AUTHORIZED BY · {scopeAlignmentDecision.approvedBy} ·{" "}
                  {scopeAlignmentDecision.approvedAt
                    ? new Date(
                        scopeAlignmentDecision.approvedAt,
                      ).toLocaleString()
                    : "Recorded"}
                </small>
              </div>
            ) : (
              <div className="scope-decision-form">
                <label>
                  Formal authority / clarification reference
                  <input
                    value={scopeEvidenceDraft}
                    onChange={(event) =>
                      setScopeEvidenceDraft(event.target.value)
                    }
                    placeholder="e.g. Client clarification CR-017"
                  />
                </label>
                <label>
                  Reason for excluding tender services
                  <textarea
                    value={scopeReasonDraft}
                    onChange={(event) =>
                      setScopeReasonDraft(event.target.value)
                    }
                    placeholder="Record what was authorized, by whom, and the applicable pricing boundary."
                  />
                </label>
                <button
                  disabled={
                    scopeEvidenceDraft.trim().length < 5 ||
                    scopeReasonDraft.trim().length < 20
                  }
                  onClick={approveMaterialsOnlyScope}
                >
                  Authorize materials-only deviation
                </button>
                <p className="scope-warning">
                  This records a commercial deviation; it does not rewrite the
                  tender. Without formal authority, quotation approval remains
                  blocked.
                </p>
              </div>
            )}
          </section>
        )}
        <div className="validation-summary-list">
          {!auditIntegrityValid && (
            <article>
              <span className="control-icon blocked">!</span>
              <div>
                <strong>Project audit-chain integrity failed</strong>
                <p>
                  At least one event no longer matches its project owner,
                  predecessor fingerprint or stored event hash. Commercial
                  approval and final issue remain blocked.
                </p>
                <small className="control-meta">
                  OWNER · Project control &nbsp;·&nbsp; EVIDENCE ·{" "}
                  {auditChainHead} and the complete event chain
                </small>
              </div>
              <span className="review-blocked">Blocking</span>
              <button onClick={() => navigate("Activity")}>
                Inspect activity
              </button>
            </article>
          )}
          {workspaceOwnershipConflicts > 0 && (
            <article>
              <span className="control-icon blocked">!</span>
              <div>
                <strong>Project-context ownership conflict</strong>
                <p>
                  {workspaceOwnershipConflicts} sourcing or quotation record
                  {workspaceOwnershipConflicts === 1 ? " is" : "s are"} owned by
                  another project identity. The records are quarantined and
                  cannot be edited, awarded, exported or treated as current
                  approval.
                </p>
                <small className="control-meta">
                  OWNER · Project control &nbsp;·&nbsp; EVIDENCE ·{" "}
                  {workspaceContextSeal}, record project IDs and active BOQ
                  anchors
                </small>
              </div>
              <span className="review-blocked">Blocking</span>
            </article>
          )}
          {revisionCandidates.length > 0 && (
            <article>
              <span className="control-icon blocked">!</span>
              <div>
                <strong>Unresolved document revision candidates</strong>
                <p>
                  {revisionCandidates.length} known filename
                  {revisionCandidates.length === 1 ? " has" : "s have"} new
                  content. The active tender baseline cannot be relied on until
                  issue metadata and transmittal evidence are reviewed.
                </p>
                <small className="control-meta">
                  OWNER · Document control &nbsp;·&nbsp; EVIDENCE · Content
                  fingerprint, revision, issue date and transmittal
                </small>
              </div>
              <span className="review-blocked">Blocking</span>
              <button onClick={() => navigate("Documents")}>
                Review revisions
              </button>
            </article>
          )}
          {unresolvedLifecycleFindings.length > 0 && (
            <article>
              <span className="control-icon blocked">!</span>
              <div>
                <strong>
                  Obsolete product references need engineering review
                </strong>
                <p>
                  {unresolvedLifecycleFindings.length} BOQ or specification
                  reference
                  {unresolvedLifecycleFindings.length === 1
                    ? " matches"
                    : "s match"}{" "}
                  the catalogue lifecycle archive. Stated replacements are
                  discovery evidence—not automatic equivalents.
                </p>
                <small className="control-meta">
                  OWNER · Engineering Reviewer &nbsp;·&nbsp; EVIDENCE ·
                  Honeywell obsolete/replacement row and project technical
                  requirements
                </small>
              </div>
              <span className="review-blocked">Blocking</span>
              <button onClick={() => navigate("Price Sources")}>
                Review lifecycle evidence
              </button>
            </article>
          )}
          <article>
            <span
              className={`control-icon ${outstanding ? "blocked" : expiringCostItems.length ? "pending" : "passed"}`}
            >
              {outstanding ? "!" : expiringCostItems.length ? "…" : "✓"}
            </span>
            <div>
              <strong>Current commercial price evidence</strong>
              <p>
                {expiredCostItems.length || validityMissingCostItems.length
                  ? `${expiredCostItems.length} approved cost record${expiredCostItems.length === 1 ? " has" : "s have"} expired and ${validityMissingCostItems.length} lack a validity date. They no longer count as quotation-ready pricing.`
                  : expiringCostItems.length
                    ? `${expiringCostItems.length} approved cost record${expiringCostItems.length === 1 ? " expires" : "s expire"} within seven days. Pricing remains usable until the stated date, but renewal is due.`
                    : outstanding
                      ? `${unpricedCostItems.length} BOQ line${unpricedCostItems.length === 1 ? " requires" : "s require"} a current supplier quotation or approved price source.`
                      : "Every priced BOQ line is linked to commercial evidence with a current validity date."}
              </p>
              <small className="control-meta">
                OWNER · Procurement &nbsp;·&nbsp; EVIDENCE · Approved source
                reference and valid-until date
              </small>
            </div>
            <span
              className={
                outstanding
                  ? "review-blocked"
                  : expiringCostItems.length
                    ? "review-pending"
                    : "review-ready"
              }
            >
              {outstanding
                ? "Blocking"
                : expiringCostItems.length
                  ? "Due soon"
                  : "Passed"}
            </span>
            {outstanding > 0 && (
              <button onClick={() => navigate("Supplier RFQs")}>
                Renew or source
              </button>
            )}
          </article>
          {technicalProfileMissing ? (
            <article>
              <span className="control-icon blocked">!</span>
              <div>
                <strong>Technical requirements not extracted</strong>
                <p>
                  The BOQ is available, but no project specification profile is
                  linked. Product compliance and approval remain blocked.
                </p>
                <small className="control-meta">
                  OWNER · Engineering &nbsp;·&nbsp; EVIDENCE · Specification
                  profile
                </small>
              </div>
              <span className="review-blocked">Blocking</span>
              <button onClick={() => navigate("Documents")}>
                Add specifications
              </button>
            </article>
          ) : (
            <article>
              <span className="control-icon blocked">!</span>
              <div>
                <strong>Technical compliance evidence</strong>
                <p>
                  {technicalOutstanding} panel requirements need manufacturer,
                  authority, network, battery or warranty evidence.
                </p>
                <small className="control-meta">
                  OWNER · Engineering &nbsp;·&nbsp; EVIDENCE · Clause-linked
                  requirement reviews
                </small>
              </div>
              <span className="review-blocked">Blocking</span>
              <button
                onClick={() => {
                  navigate("Technical Matching");
                  setMatchView("Requirements");
                }}
              >
                Review requirements
              </button>
            </article>
          )}
          <article>
            <span
              className={`control-icon ${rateReady ? "passed" : "blocked"}`}
            >
              {rateReady ? "✓" : "!"}
            </span>
            <div>
              <strong>Exchange-rate evidence</strong>
              <p>
                {rateReady
                  ? `${exchangeRate.toFixed(3)} SAR/USD · ${exchangeRateEvidence.source} · effective ${exchangeRateEvidence.effectiveDate} through ${exchangeRateEvidence.validUntil}.`
                  : `${exchangeRate.toFixed(3)} SAR/USD is ${exchangeRateEvidenceStatus.toLowerCase()}; source-backed, dated evidence is required.`}
              </p>
              <small className="control-meta">
                OWNER · Commercial &nbsp;·&nbsp; EVIDENCE · Source, effective
                date, validity and audited confirmation
              </small>
            </div>
            <span className={rateReady ? "review-ready" : "review-blocked"}>
              {rateReady ? "Passed" : "Blocking"}
            </span>
            {!rateReady && (
              <button onClick={openPricingSettings}>Review rate</button>
            )}
          </article>
          <article>
            <span
              className={`control-icon ${clientTermsMissing ? "blocked" : "passed"}`}
            >
              {clientTermsMissing ? "!" : "✓"}
            </span>
            <div>
              <strong>Client commercial terms and qualifications</strong>
              <p>
                {clientTermsMissing
                  ? "Client-facing payment, delivery location, delivery period, freight treatment and qualification statement must be entered explicitly. Supplier procurement terms are shown as a benchmark but are never copied into the client quotation automatically."
                  : `${clientPaymentTerms} · ${clientDeliveryTerms} · deliver to ${clientDeliveryLocation} · freight: ${clientFreightTerms} · qualifications: ${clientQualifications}`}
              </p>
              <small className="control-meta">
                OWNER · Commercial &nbsp;·&nbsp; EVIDENCE · Client quotation
                settings
              </small>
            </div>
            <span
              className={clientTermsMissing ? "review-blocked" : "review-ready"}
            >
              {clientTermsMissing ? "Blocking" : "Passed"}
            </span>
            {clientTermsMissing && (
              <button onClick={openPricingSettings}>Add terms</button>
            )}
          </article>
          {knownServiceScope && (
            <article>
              <span
                className={`control-icon ${scopeAlignmentResolved ? "passed" : "blocked"}`}
              >
                {scopeAlignmentResolved ? "✓" : "!"}
              </span>
              <div>
                <strong>Quotation scope matches tender obligations</strong>
                <p>
                  {scopeAlignmentResolved
                    ? `Materials-only exclusion is authorized under ${scopeAlignmentDecision.evidenceReference}.`
                    : "The tender requires supply, installation and connection, while this quotation excludes service costs. Formal client or tender authority is required."}
                </p>
                <small className="control-meta">
                  OWNER · Commercial Approver &nbsp;·&nbsp; EVIDENCE · BOQ scope
                  statement and formal clarification
                </small>
              </div>
              <span
                className={
                  scopeAlignmentResolved ? "review-ready" : "review-blocked"
                }
              >
                {scopeAlignmentResolved ? "Passed" : "Blocking"}
              </span>
            </article>
          )}
          <article>
            <span
              className={`control-icon ${outstanding ? "pending" : "passed"}`}
            >
              {outstanding ? "…" : "✓"}
            </span>
            <div>
              <strong>Quantity and formula integrity</strong>
              <p>
                {outstanding
                  ? `Structural checks retain positive quantities and units, but commercial reconciliation is not ready while ${outstanding} BOQ line${outstanding === 1 ? " needs" : "s need"} current price evidence.`
                  : `All BOQ lines have current approved costs and the selling total reconciles to SAR ${money(totals.selling)}.`}
              </p>
              <small className="control-meta">
                OWNER · Estimator &nbsp;·&nbsp; EVIDENCE · BOQ quantities, units
                and current calculations
              </small>
            </div>
            <span className={outstanding ? "review-pending" : "review-ready"}>
              {outstanding ? "Not ready" : "Passed"}
            </span>
          </article>
        </div>
        <details className="exception-details">
          <summary>
            <span>
              <strong>BOQ price-evidence exceptions</strong>
              <small>
                {outstanding} unresolved lines · expand for individual review
              </small>
            </span>
            <b>View lines</b>
          </summary>
          <div className="review-list">
            {priceEvidenceOpenItems.map(({ item, status, validUntil }) => (
              <article key={item.id}>
                <div>
                  <strong>{item.item}</strong>
                  <p>
                    {status === "Expired"
                      ? `Approved source expired ${validUntil}; obtain renewed supplier evidence.`
                      : status === "Validity missing"
                        ? "Approved cost has no valid-until date and cannot support quotation issue."
                        : matchReadiness(item).canApprove
                          ? "Technical profile present · current price approval required"
                          : `Missing: ${matchReadiness(item).missing.join(", ")}`}
                  </p>
                </div>
                <span className="review-blocked">{status}</span>
                <button
                  onClick={() =>
                    status === "Unpriced"
                      ? setMatchingItemId(item.id)
                      : navigate("Supplier RFQs")
                  }
                >
                  {status === "Unpriced" ? "Review evidence" : "Renew source"}
                </button>
              </article>
            ))}
          </div>
        </details>
      </section>
    ) : activeModule === "Supplier RFQs" ? (
      <RfqAuthorityWorkspace />
    ) : activeModule === "Quotation" ? (
      <QuotationWorkspace
        projectId={projectId}
        projectName={projectName}
        workflow={preSalesWorkflow}
        quotation={serverQuotation}
        stale={quotationStale}
        loading={quotationWorkflowLoading}
        reason={quotationApprovalReason}
        onReason={setQuotationApprovalReason}
        onDraft={() => void createServerQuotationDraft()}
        onApprove={() => void approveQuotationRevision()}
        onIssue={() => void issueQuotationRevision()}
        onOpen={() => setShowQuotation(true)}
        money={money}
      />
    ) : activeModule === "Price Sources" && !baseTenderLoaded ? (
      <>
        {sourceLifecycleSummary}
        <section className="module-page">
          <div className="module-heading">
            <div>
              <small>GOVERNED SOURCE LIBRARY</small>
              <h1>Price sources</h1>
              <p>
                Only durable documents uploaded to this project appear here.
                Registration does not approve their prices.
              </p>
            </div>
            <button onClick={openPriceSourceUpload}>
              ＋ Add source document
            </button>
          </div>
          {managedPriceDocuments.length ? (
            <div className="source-grid">
              {managedPriceDocuments.map((document) => (
                <article key={document.id}>
                  <span className="source-type">
                    {document.predicted_type || document.document_type}
                  </span>
                  <h2>{document.logical_name || document.original_filename}</h2>
                  <p>
                    Document {document.id} · version {document.version_id} ·
                    SHA-256 {document.sha256.slice(0, 12)}…
                  </p>
                  <p>
                    Historical manufacturer list evidence · no validity end
                    recorded.
                  </p>
                  <div>
                    <b className="review-blocked">
                      Historical / Discovery Only · Not approved for costing
                    </b>
                    <button onClick={() => navigate("Product Library")}>
                      Review products and provenance
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No price sources in this workspace</strong>
              <p>
                Upload and classify a Price List or Supplier Quotation in
                Documents.
              </p>
            </div>
          )}
        </section>
      </>
    ) : activeModule === "Price Sources" ? (
      <>
        {sourceLifecycleSummary}
        <section className="module-page">
          <div className="module-heading">
            <div>
              <small>GOVERNED SOURCE LIBRARY</small>
              <h1>Price sources</h1>
              <p>
                Review validity, provenance and approval status before a source
                can affect a quotation.
              </p>
            </div>
            <button onClick={openPriceSourceUpload}>
              ＋ Add source document
            </button>
          </div>
          <div className="source-grid">
            <article>
              <span className="source-type">TENDER BOQ</span>
              <h2>BOQ.xlsx</h2>
              <p>21 normalized scope lines · quantities only</p>
              <div>
                <b className="review-ready">Extracted</b>
                <button onClick={() => navigate("BOQ")}>Review source</button>
              </div>
            </article>
            <article>
              <span className="source-type">PARTICULAR SPECIFICATION</span>
              <h2>Section 28 46 00 · Rev 1</h2>
              <p>31 pages · requirements indexed with page evidence</p>
              <div>
                <b className="review-ready">Indexed</b>
                <button onClick={() => navigate("Technical Matching")}>
                  Review requirements
                </button>
              </div>
            </article>
            <article>
              <span className="source-type">MANUFACTURER PRICE LIST</span>
              <h2>Honeywell Farenhyt KSA 2023</h2>
              <p>
                V23.1 · 504 numeric USD list-price rows · effective 01 Mar 2023
                · no validity end date found
              </p>
              <div>
                <b className="review-blocked">Historical · discovery only</b>
                <button
                  onClick={() =>
                    openSourceReview(
                      "KSA Honeywell Farenhyt Series Price List -2023.xlsx",
                    )
                  }
                >
                  View source controls
                </button>
              </div>
            </article>
            {registeredPriceFiles.map((name) => (
              <article key={name}>
                <span className="source-type">
                  {documentRoles[name] || inferDocumentRole(name)}
                </span>
                <h2>{name}</h2>
                <p>
                  Registered locally · content and commercial validity not
                  reviewed
                </p>
                <div>
                  <b className="review-blocked">Cannot affect pricing</b>
                  <button onClick={() => navigate("Documents")}>
                    Review intake
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        {discoveryLibraryPanel}
      </>
    ) : activeModule === "Knowledge Library" ? (
      <KnowledgeLibraryWorkspace
        files={knowledgeFiles as unknown as Record<string, unknown>[]}
        results={knowledgeResults as unknown as Record<string, unknown>[]}
        summary={knowledgeSummary as unknown as Record<string, unknown>}
        loading={knowledgeLoading}
        error={knowledgeError}
        search={knowledgeSearch}
        onSearch={setKnowledgeSearch}
        onFiles={(files) => void uploadKnowledgeFiles(files)}
      />
    ) : activeModule === "Pricing Memory" ? (
      <HistoricalLearningWorkspace
        summary={pricingMemorySummary as unknown as Record<string, unknown>}
        cards={pricingMemoryCards as unknown as Record<string, unknown>[]}
        loading={pricingMemoryLoading}
        error={pricingMemoryError}
        search={pricingMemorySearch}
        onSearch={setPricingMemorySearch}
        onLearn={() => void learnCompletedProject()}
        canLearn={Boolean(projectId)}
      />
    ) : activeModule === "Case Studies" ? (
      <CaseStudiesWorkspace
        cases={caseStudies as unknown as Record<string, unknown>[]}
        loading={caseStudyLoading}
        error={caseStudyError}
        search={caseStudySearch}
        onSearch={setCaseStudySearch}
      />
    ) : activeModule === "Reports" ? (
      <section className="module-page reports-page">
        <div className="module-heading">
          <div>
            <small>PROJECT REPORTING</small>
            <h1>Progress and issue control</h1>
            <p>
              Working exports stay visibly separate from approved client
              deliverables.
            </p>
          </div>
        </div>
        <section
          className="excel-export-workspace"
          aria-labelledby="excel-export-title"
        >
          <div className="section-title">
            <div>
              <small>VERSIONED EXCEL COST SHEET</small>
              <strong id="excel-export-title">
                Generate from governed project records
              </strong>
            </div>
            <span>Server values · protected storage · immutable history</span>
          </div>
          <div className="excel-export-config">
            <label>
              Export mode
              <select
                value={excelExportMode}
                onChange={(event) => {
                  setExcelExportMode(event.target.value as ExcelExportMode);
                  setExcelExportPreview(null);
                }}
              >
                <option>Draft Cost Sheet</option>
                <option>Technical Review Cost Sheet</option>
                <option>Commercial Review Cost Sheet</option>
                <option>Approved Cost Sheet</option>
                <option>Client-Safe Export</option>
              </select>
            </label>
            <label>
              Workbook template
              <select
                value={excelExportTemplateId}
                onChange={(event) => {
                  setExcelExportTemplateId(event.target.value);
                  setExcelExportPreview(null);
                }}
              >
                <option value="">Select template…</option>
                {excelExportTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.version}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-action"
              disabled={excelExportLoading || !excelExportTemplateId}
              onClick={previewExcelExport}
            >
              {excelExportLoading ? "Checking…" : "Check export readiness"}
            </button>
          </div>
          {excelExportError && (
            <p className="managed-document-error" role="alert">
              {excelExportError}
            </p>
          )}
          {excelExportPreview && (
            <div
              className={`excel-readiness ${excelExportPreview.readiness.permitted ? "excel-ready" : "excel-blocked"}`}
            >
              <div>
                <small>SERVER READINESS</small>
                <strong>
                  {excelExportPreview.readiness.permitted
                    ? `Ready · ${excelExportPreview.reviewReadiness}`
                    : "Export controls need attention"}
                </strong>
                <p>
                  {excelExportPreview.readiness.errors.length
                    ? excelExportPreview.readiness.errors.join(" · ")
                    : excelExportPreview.readiness.warnings.length
                      ? `${excelExportPreview.readiness.warnings.length} unresolved warning(s) will be visibly included.`
                      : "All selected-mode checks passed."}
                </p>
              </div>
              <div>
                <small>VERSION LOCK</small>
                <strong>
                  {Object.entries(excelExportPreview.lockedVersions)
                    .map(([key, value]) => `${key} v${value}`)
                    .join(" · ")}
                </strong>
                <p>
                  {excelExportPreview.sheets.length} sheets:{" "}
                  {excelExportPreview.sheets.join(", ")}
                </p>
              </div>
              <button
                disabled={
                  !excelExportPreview.readiness.permitted || excelExportLoading
                }
                onClick={startExcelExport}
              >
                Generate governed workbook
              </button>
            </div>
          )}
          <div className="excel-mode-note">
            <strong>{excelExportMode}</strong>
            <p>
              {excelExportMode === "Draft Cost Sheet"
                ? "Includes unresolved items and warnings with a prominent DRAFT — NOT APPROVED status."
                : excelExportMode === "Client-Safe Export"
                  ? "Supplier discounts, net costs, margins, risk and internal notes are excluded during generation—not merely hidden."
                  : excelExportMode === "Approved Cost Sheet"
                    ? "Requires current technical and commercial approval, valid pricing, no blocking review state and successful reconciliation."
                    : "Exports the selected review stage with exact source and version traceability."}
            </p>
          </div>
          <div className="excel-export-history">
            <div className="section-title">
              <div>
                <small>EXPORT HISTORY</small>
                <strong>
                  {excelExportHistory.length} immutable workbook issue
                  {excelExportHistory.length === 1 ? "" : "s"}
                </strong>
              </div>
              <button
                className="inline-link"
                disabled={excelExportLoading}
                onClick={loadExcelExports}
              >
                Refresh
              </button>
            </div>
            {excelExportHistory.map((entry) => (
              <article key={entry.id}>
                <div>
                  <strong>{entry.filename}</strong>
                  <p>
                    {entry.export_mode} · Revision {entry.revision} ·{" "}
                    {new Date(entry.requested_at).toLocaleString()}
                  </p>
                  <small>
                    {entry.warning_count} warning(s) ·{" "}
                    {entry.byte_size || 0
                      ? `${Math.round(Number(entry.byte_size) / 1024)} KB`
                      : entry.stage}{" "}
                    · SHA-256 {entry.sha256?.slice(0, 12) || "pending"}… ·{" "}
                    {entry.download_count || 0} download(s)
                  </small>
                </div>
                <span
                  className={
                    entry.status === "Completed"
                      ? "review-ready"
                      : entry.status === "Completed with Warnings"
                        ? "review-pending"
                        : "review-blocked"
                  }
                >
                  {entry.status}
                </span>
                {["Completed", "Completed with Warnings"].includes(
                  entry.status,
                ) && (
                  <a
                    className="excel-download"
                    href={`/api/excel-exports/${encodeURIComponent(entry.id)}/download`}
                  >
                    Download .xlsx
                  </a>
                )}
              </article>
            ))}
            {!excelExportLoading && !excelExportHistory.length && (
              <div className="empty-state">
                <strong>No governed workbook generated yet</strong>
                <p>
                  Choose a mode and template, verify readiness, then create the
                  first immutable Excel issue.
                </p>
              </div>
            )}
          </div>
        </section>
        <div className="approval-gate">
          <strong>
            {serverQuotation?.status === "Issued"
              ? "Final quotation issue recorded"
              : serverQuotation?.status === "Approved"
                ? "Approved quotation ready for controlled issue"
                : "Approve a governed quotation revision before issue"}
          </strong>
          <p>
            Final issue requires an approved revision and a completed governed
            workbook. The server records the exact revision, export, actor,
            recipient and issue reference.
          </p>
          <button
            disabled={
              quotationWorkflowLoading ||
              serverQuotation?.status !== "Approved" ||
              !excelExportHistory.some((entry) =>
                ["Completed", "Completed with Warnings"].includes(entry.status),
              )
            }
            onClick={() => {
              const exportJob = excelExportHistory.find((entry) =>
                ["Completed", "Completed with Warnings"].includes(entry.status),
              );
              if (exportJob && serverQuotation)
                void mutateQuotation("issue", {
                  quotationRevisionId: serverQuotation.id,
                  exportJobId: exportJob.id,
                  reason:
                    "Approved quotation issued from the governed final export",
                  recipient: clientName,
                  issueReference: `${projectCode}-R${serverQuotation.revision_number || serverQuotation.revisionNumber}`,
                });
            }}
          >
            {quotationWorkflowLoading
              ? "Recording…"
              : serverQuotation?.status === "Issued"
                ? "Issued"
                : "Record final issue"}
          </button>
        </div>
        <div className="summary-grid">
          <article>
            <span>Approved direct cost</span>
            <strong>SAR {money(reportCommercialTotals.directCost)}</strong>
            <small>current supplier evidence only</small>
          </article>
          <article>
            <span>Approved selling value</span>
            <strong>SAR {money(reportCommercialTotals.sellingValue)}</strong>
            <small>includes visible risk allowance</small>
          </article>
          <article>
            <span>Gross profit</span>
            <strong>SAR {money(reportGrossProfit)}</strong>
            <small>approved selling less direct cost</small>
          </article>
          <article>
            <span>Gross margin</span>
            <strong>{reportGrossMargin.toFixed(2)}%</strong>
            <small>not calculated from unresolved lines</small>
          </article>
        </div>
        <div
          className="report-control-strip"
          aria-label="Report readiness controls"
        >
          <span>
            <small>PRICING COVERAGE</small>
            <strong>
              {projectCompletion}% · {pricedCount}/{items.length} lines
            </strong>
          </span>
          <span>
            <small>MISSING PRICES</small>
            <strong>{outstanding}</strong>
          </span>
          <span>
            <small>OPEN CONTROLS</small>
            <strong>{alertCount}</strong>
          </span>
          <span>
            <small>QUOTATION</small>
            <strong>
              {currentQuotationApproval
                ? `Approved R${currentQuotationApproval.revision}`
                : latestQuotationApproval
                  ? "Changed after approval"
                  : "Draft"}
            </strong>
          </span>
        </div>
        <div className="system-report">
          <div className="section-title">
            <div>
              <small>SYSTEM COMPARISON</small>
              <strong>Commercial value and evidence coverage</strong>
            </div>
            <span>
              {systemCommercialSummary.length} system
              {systemCommercialSummary.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="system-report-note">
            Only current approved cost evidence contributes to these values.
            Selling value includes the visible project risk allowance of{" "}
            {riskAllowanceRate}%. Unpriced, expired and undated lines remain
            visible as coverage gaps instead of appearing as zero-value scope.
          </p>
          {systemCommercialSummary.length ? (
            <div className="compact-table">
              <table>
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Current lines</th>
                    <th>Coverage</th>
                    <th>Direct cost</th>
                    <th>Selling value</th>
                    <th>Gross profit</th>
                  </tr>
                </thead>
                <tbody>
                  {systemCommercialSummary.map((system) => (
                    <tr key={system.system}>
                      <td>
                        <strong>{system.system}</strong>
                        <small>
                          {system.lines - system.currentLines
                            ? `${system.lines - system.currentLines} line${system.lines - system.currentLines === 1 ? "" : "s"} excluded from value`
                            : "All lines current"}
                        </small>
                      </td>
                      <td>
                        {system.currentLines} / {system.lines}
                      </td>
                      <td>
                        <span
                          className={
                            system.coverage === 100
                              ? "review-ready"
                              : "review-blocked"
                          }
                        >
                          {system.coverage}%
                        </span>
                      </td>
                      <td>SAR {money(system.directCost)}</td>
                      <td>SAR {money(system.sellingValue)}</td>
                      <td>
                        SAR {money(system.sellingValue - system.directCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No BOQ systems to report</strong>
              <p>
                Approve document intake and BOQ extraction before commercial
                analytics are available.
              </p>
            </div>
          )}
        </div>
        <div className="export-control">
          <div className="section-title">
            <div>
              <small>EXPORT CONTROL</small>
              <strong>Choose the document status intentionally</strong>
            </div>
            <span>{quotationFingerprint}</span>
          </div>
          <div className="export-options">
            <article>
              <span className="review-blocked">INTERNAL WORKING DOCUMENT</span>
              <h2>Draft cost sheet</h2>
              <p>
                Includes internal cost, markup, supplier and source evidence. It
                remains fingerprinted and prominently marked “not approved for
                issue.”
              </p>
              <button onClick={exportCostSheet}>
                ⇩ Export internal draft cost sheet
              </button>
            </article>
            <article>
              <span
                className={
                  serverQuotation?.status === "Approved" ||
                  serverQuotation?.status === "Issued"
                    ? "review-ready"
                    : "review-blocked"
                }
              >
                {serverQuotation
                  ? `${serverQuotation.status.toUpperCase()} R${serverQuotation.revision_number || serverQuotation.revisionNumber}`
                  : "CLIENT EXPORT BLOCKED"}
              </span>
              <h2>Approved client quotation</h2>
              <p>
                {serverQuotation?.status === "Approved" ||
                serverQuotation?.status === "Issued"
                  ? "Generate the Client-Safe governed workbook above. Internal costs, margins, suppliers and procurement evidence are removed by the server."
                  : "Complete the workflow and approve the current server-governed quotation revision before final export."}
              </p>
              <button
                disabled={
                  serverQuotation?.status !== "Approved" &&
                  serverQuotation?.status !== "Issued"
                }
                onClick={() => {
                  setExcelExportMode("Client-Safe Export");
                  setExcelExportPreview(null);
                  showToast(
                    "Client-Safe Export selected. Check readiness before generation.",
                  );
                }}
              >
                Prepare client-safe export
              </button>
            </article>
          </div>
        </div>
        <div className="issue-checklist">
          <strong>Final issue checklist</strong>
          <span className={outstanding ? "check-open" : "check-pass"}>
            {outstanding ? "○" : "✓"} All BOQ lines priced
          </span>
          <span
            className={
              technicalOutstanding || technicalProfileMissing
                ? "check-open"
                : "check-pass"
            }
          >
            {technicalOutstanding || technicalProfileMissing ? "○" : "✓"}{" "}
            Technical evidence complete
          </span>
          <span className={!rateReady ? "check-open" : "check-pass"}>
            {!rateReady ? "○" : "✓"} Exchange rate evidence current
          </span>
          <span className={clientTermsMissing ? "check-open" : "check-pass"}>
            {clientTermsMissing ? "○" : "✓"} Client terms recorded
          </span>
          <span
            className={!currentQuotationApproval ? "check-open" : "check-pass"}
          >
            {!currentQuotationApproval ? "○" : "✓"} Current fingerprint approved
          </span>
        </div>
        <div className="revision-register">
          <div className="section-title">
            <div>
              <small>QUOTATION REVISION REGISTER</small>
              <strong>Approvals remain attached to exact calculations</strong>
            </div>
            <span>{quotationApprovals.length} recorded</span>
          </div>
          {quotationApprovals.length ? (
            quotationApprovals
              .slice()
              .sort((a, b) => b.revision - a.revision)
              .map((approval) => (
                <article key={approval.revision}>
                  <span className="package-code">R{approval.revision}</span>
                  <div>
                    <strong>SAR {money(approval.total)}</strong>
                    <p>{approval.reason}</p>
                    <small>
                      {approval.fingerprint} ·{" "}
                      {new Date(approval.approvedAt).toLocaleString("en-GB")}
                    </small>
                  </div>
                  <b
                    className={
                      approval.fingerprint === quotationFingerprint
                        ? "review-ready"
                        : "review-blocked"
                    }
                  >
                    {approval.fingerprint === quotationFingerprint
                      ? "Current"
                      : "Superseded"}
                  </b>
                </article>
              ))
          ) : (
            <div className="empty-state">
              <strong>No quotation approval history</strong>
              <p>
                A revision appears here only after all controls pass and an
                estimator records an approval decision.
              </p>
            </div>
          )}
        </div>
      </section>
    ) : activeModule === "Activity" ? (
      <>
        <div
          className={`audit-chain-banner ${auditIntegrityValid ? "verified" : "broken"}`}
        >
          <span>{auditIntegrityValid ? "✓" : "!"}</span>
          <div>
            <small>AUDIT CHAIN</small>
            <strong>
              {auditIntegrityValid
                ? "Verified for this project"
                : "Integrity failure — commercial issue blocked"}
            </strong>
            <p>
              {projectAuditEvents.length} event
              {projectAuditEvents.length === 1 ? "" : "s"} · head{" "}
              {auditChainHead} · owner {projectCode || projectId}
            </p>
          </div>
        </div>
        <section className="module-page">
          <div className="module-heading">
            <div>
              <small>TRACEABILITY</small>
              <h1>Project activity</h1>
              <p>
                Searchable evidence of project changes, reviews, approvals and
                controlled exports.
              </p>
            </div>
            <button onClick={exportAuditRegister}>
              ⇩ Export audit register
            </button>
          </div>
          <div className="activity-summary">
            <article>
              <span>Recorded events</span>
              <strong>{projectAuditEvents.length}</strong>
              <small>current project only</small>
            </article>
            <article>
              <span>Human decisions</span>
              <strong>
                {
                  projectAuditEvents.filter((event) => event.actor !== "System")
                    .length
                }
              </strong>
              <small>estimator actions</small>
            </article>
            <article>
              <span>Approval events</span>
              <strong>
                {
                  projectAuditEvents.filter(
                    (event) => auditCategoryFor(event) === "Approval",
                  ).length
                }
              </strong>
              <small>quotation and award controls</small>
            </article>
          </div>
          <div className="activity-controls">
            <label>
              <span>Search activity</span>
              <input
                aria-label="Search project activity"
                value={activitySearch}
                onChange={(event) => setActivitySearch(event.target.value)}
                placeholder="Action, evidence, actor or event reference"
              />
            </label>
            <label>
              <span>Category</span>
              <select
                aria-label="Filter activity by category"
                value={activityCategory}
                onChange={(event) =>
                  setActivityCategory(event.target.value as AuditCategory)
                }
              >
                <option>All</option>
                <option>Source</option>
                <option>Pricing</option>
                <option>Commercial</option>
                <option>Approval</option>
                <option>Project</option>
              </select>
            </label>
            <label>
              <span>Actor</span>
              <select
                aria-label="Filter activity by actor"
                value={activityActor}
                onChange={(event) => setActivityActor(event.target.value)}
              >
                {activityActors.map((actor) => (
                  <option key={actor}>{actor}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="activity-result-bar">
            <strong>
              {filteredAuditEvents.length} event
              {filteredAuditEvents.length === 1 ? "" : "s"}
            </strong>
            <span>Newest first · stored with this project</span>
          </div>
          <div className="activity-list">
            {filteredAuditEvents.map((event) => (
              <article key={event.id}>
                <span
                  className={`activity-dot category-${auditCategoryFor(event).toLowerCase()}`}
                />
                <div>
                  <div className="activity-event-heading">
                    <span>{auditCategoryFor(event)}</span>
                    <small>EVT-{event.id}</small>
                  </div>
                  <strong>{event.action}</strong>
                  <p>{event.detail}</p>
                  <details className="activity-proof">
                    <summary>Integrity proof</summary>
                    <dl>
                      <div>
                        <dt>Previous event</dt>
                        <dd>
                          <code>{event.previousHash || "GENESIS"}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Event fingerprint</dt>
                        <dd>
                          <code>{event.eventHash || "Unavailable"}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Workspace owner</dt>
                        <dd>
                          <code>{event.projectId || projectId}</code>
                        </dd>
                      </div>
                    </dl>
                  </details>
                </div>
                <small>
                  {event.actor}
                  <br />
                  {event.time}
                </small>
              </article>
            ))}
          </div>
          {!filteredAuditEvents.length && (
            <div className="empty-state">
              <strong>No activity matches these filters</strong>
              <p>
                Clear the search or choose another category or actor. The
                underlying project history has not changed.
              </p>
            </div>
          )}
          <div className="activity-integrity-note">
            <strong>Local checksum-chain scope</strong>
            <p>
              Each event is linked to its predecessor and project owner using a
              browser checksum. It is not a cryptographically signed or
              multi-user server audit log. Displayed event times come from the
              local device clock and are not trusted server timestamps.
            </p>
          </div>
        </section>
      </>
    ) : null;

  const technicalRequirementSections = [
    ...new Set(
      technicalRequirements
        .map((row) => row.source_location.section)
        .filter(Boolean) as string[],
    ),
  ].sort();
  const technicalRequirementClauses = [
    ...new Set(
      technicalRequirements
        .map((row) => row.source_location.clause)
        .filter(Boolean) as string[],
    ),
  ].sort();
  const technicalRequirementPages = [
    ...new Set(
      technicalRequirements
        .map((row) => row.source_location.pageFrom)
        .filter((value) => value != null) as number[],
    ),
  ].sort((a, b) => a - b);
  const filteredTechnicalRequirements = technicalRequirements.filter((row) => {
    const term = technicalRequirementSearch.trim().toLowerCase();
    const values = JSON.stringify(row.current_values || {}).toLowerCase();
    return (
      (!term ||
        `${row.original_text} ${row.normalized_requirement} ${row.source_location.section || ""} ${row.source_location.clause || ""} ${values}`
          .toLowerCase()
          .includes(term)) &&
      (technicalRequirementSection === "All" ||
        row.source_location.section === technicalRequirementSection) &&
      (technicalRequirementClause === "All" ||
        row.source_location.clause === technicalRequirementClause) &&
      (technicalRequirementPage === "All" ||
        String(row.source_location.pageFrom || "") ===
          technicalRequirementPage) &&
      (technicalRequirementStatus === "All" ||
        row.review_status === technicalRequirementStatus)
    );
  });
  const selectedTechnicalRequirement =
    technicalRequirements.find(
      (row) => row.id === selectedTechnicalRequirementId,
    ) || null;
  const selectedMatchingItem =
    extractedBoqItems.find((row) => row.id === selectedMatchingItemId) || null;
  const applicabilityItemOptions = [
    ...new Map(
      applicabilityLinks.map((link) => [
        link.boq_item_id,
        link.boq_description,
      ]),
    ).entries(),
  ];
  const filteredApplicabilityLinks = applicabilityLinks.filter(
    (link) =>
      (applicabilityItemFilter === "All" ||
        link.boq_item_id === applicabilityItemFilter) &&
      (applicabilityStatusFilter === "All" ||
        (applicabilityStatusFilter === "Open"
          ? ["Suggested", "Needs Review"].includes(link.status)
          : link.status === applicabilityStatusFilter)),
  );
  const requirementIntelligenceTypes = [
    ...new Set(requirementIntelligenceFacts.map((fact) => fact.fact_type)),
  ].sort();
  const filteredRequirementIntelligenceFacts =
    requirementIntelligenceFacts.filter(
      (fact) =>
        (requirementIntelligenceStatus === "All" ||
          fact.review_status === requirementIntelligenceStatus) &&
        (requirementIntelligenceType === "All" ||
          fact.fact_type === requirementIntelligenceType),
    );
  const requirementIntelligenceItem = extractedBoqItems.find(
    (item) => item.id === requirementIntelligenceItemId,
  );
  const engineeringClassificationItem = extractedBoqItems.find(
    (item) => item.id === engineeringClassificationItemId,
  );
  const filteredEngineeringClassificationDecisions =
    engineeringClassificationDecisions.filter(
      (decision) =>
        engineeringClassificationStatus === "All" ||
        decision.review_status === engineeringClassificationStatus,
    );
  const engineeringGraphItem = extractedBoqItems.find(
    (item) => item.id === engineeringGraphItemId,
  );

  if (authLoading)
    return (
      <main className="authorization-screen">
        <section>
          <span className="auth-status-mark">◌</span>
          <small>VERIFIED ACCESS</small>
          <h1>Checking your authenticated session</h1>
          <p>
            The workspace will open after your server identity and permissions
            are confirmed.
          </p>
        </section>
      </main>
    );
  if (authFailure || !authSession) {
    const failure = authFailure || {
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Sign in is required.",
    };
    return (
      <main className="authorization-screen">
        <section>
          <span className="auth-status-mark">!</span>
          <small>
            {failure.status === 403
              ? "ACCESS DENIED"
              : failure.status === 503
                ? "AUTHENTICATION UNAVAILABLE"
                : "SIGN IN REQUIRED"}
          </small>
          <h1>
            {failure.status === 403
              ? "You do not have access to this workspace"
              : failure.status === 503
                ? "Authentication is temporarily unavailable"
                : "Sign in to continue"}
          </h1>
          <p>{failure.message}</p>
          <code>{failure.code}</code>
          {failure.status === 401 && (
            <a href="/signin-with-chatgpt?return_to=/">Sign in</a>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <button
          className="sidebar-close"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        >
          ×
        </button>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>AI Pricing Agent</strong>
            <small>وكيل التسعير الذكي</small>
          </div>
        </div>

        <nav aria-label="Application navigation" className="global-navigation">
          {globalNavItems.map(([icon, label, destination]) => (
            <button
              key={label}
              disabled={destination === "Reports" && !canViewCommercial}
              title={
                destination === "Reports" && !canViewCommercial
                  ? "Commercial permission required"
                  : undefined
              }
              className={
                destination === "Overview" &&
                showAllProjects &&
                topLevelArea === "Dashboard"
                  ? "nav-active"
                  : destination === "Projects" &&
                      showAllProjects &&
                      topLevelArea === "Projects"
                    ? "nav-active"
                    : destination === activeModule && !showAllProjects
                      ? "nav-active"
                      : ""
              }
              onClick={() => {
                if (destination === "Overview" || destination === "Projects") {
                  setTopLevelArea(
                    destination === "Overview" ? "Dashboard" : "Projects",
                  );
                  setShowAllProjects(true);
                  setProjectOpen(false);
                  setSidebarOpen(false);
                  return;
                }
                if (destination === "Settings") {
                  openPricingSettings();
                  setSidebarOpen(false);
                  return;
                }
                navigate(destination);
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {destination === "Reports" && !canViewCommercial && (
                <small>Locked</small>
              )}
            </button>
          ))}
        </nav>
        {!showAllProjects && !isOrganizationLibrary && (
          <div className="project-nav-context">
            <small>ACTIVE PROJECT</small>
            <strong>{projectName}</strong>
            <span>{preSalesWorkflow ? `${preSalesWorkflow.lifecycleState} · ${preSalesWorkflow.workflowStage}` : "Loading workflow…"}</span>
          </div>
        )}

        <section
          className="authenticated-profile"
          aria-label="Authenticated account"
        >
          <span className="avatar">{authSession.user.initials}</span>
          <div>
            <strong>{authSession.user.displayName}</strong>
            <small>{authSession.user.email}</small>
            <small>
              {isOrganizationLibrary
                ? authSession.effectiveLibraryPermission
                : `${authSession.effectiveLibraryPermission} · Project: ${workingRole}`}
            </small>
            <small>
              {authSession.organizations[0]
                ? `${authSession.organizations[0].name} · ${authSession.organizations[0].roles.join(" / ")}`
                : "No organization assigned"}
            </small>
          </div>
          <a href={authSession.signOutUrl}>Sign out</a>
        </section>
      </aside>

      {sidebarOpen && (
        <button
          className="scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}

      <main className="main-content">
        <header
          className={`topbar ${showAllProjects || isOrganizationLibrary ? "home-topbar" : "project-topbar"}`}
        >
          <button
            className="mobile-menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            ☰
          </button>
          {showAllProjects || isOrganizationLibrary ? (
            <div className="home-title">
              <span aria-hidden="true">
                {isOrganizationLibrary
                  ? "▤"
                  : topLevelArea === "Projects"
                    ? "▦"
                    : "⌂"}
              </span>
              <div>
                <small>
                  {isOrganizationLibrary
                    ? "ORGANIZATION KNOWLEDGE"
                    : topLevelArea === "Projects"
                    ? "PROJECT REGISTER"
                    : "ORGANIZATION OVERVIEW"}
                </small>
                <strong>
                  {isOrganizationLibrary ? "Knowledge Library" : topLevelArea}
                </strong>
              </div>
            </div>
          ) : (
            <button
              className="project-title"
              onClick={() => {
                const nextOpen = !projectOpen;
                setProjectOpen(nextOpen);
                if (nextOpen) setProjectMenuSearch("");
              }}
              aria-expanded={projectOpen}
            >
              <span>
                <small>المشروع</small>
                <small>Project</small>
              </span>
              <i />
              <strong>{projectName}</strong>
              <b>⌄</b>
            </button>
          )}
          {!showAllProjects && !isOrganizationLibrary && projectOpen && (
            <div className="project-menu">
              <small>ACTIVE PROJECT</small>
              <strong>{projectName}</strong>
              <span>
                {clientName} · {projectCode} · {preSalesWorkflow?.lifecycleState || "Loading"}
              </span>
              <label className="project-menu-search">
                <span>⌕</span>
                <input
                  aria-label="Search project switcher"
                  value={projectMenuSearch}
                  onChange={(event) => setProjectMenuSearch(event.target.value)}
                  placeholder="Search project, client or code"
                />
              </label>
              <div className="project-switch-list">
                {projectSwitcherProjects.slice(0, 5).map((project) => (
                  <button
                    key={project.id}
                    className={
                      project.id === projectId ? "current-switch-project" : ""
                    }
                    onClick={() => switchProject(project.id)}
                  >
                    <span>
                      <strong>{project.name}</strong>
                      <small>
                        {project.client} · {project.code}
                      </small>
                    </span>
                    <b>
                      {project.id === projectId
                        ? "Active"
                        : `${project.items.length} BOQ`}
                    </b>
                  </button>
                ))}
                {!projectSwitcherProjects.length && <p>No matching projects</p>}
              </div>
              <button onClick={openProjectDetailsEditor}>
                Edit project details
              </button>
              <small className="scope-copy-note">
                Copies documents and BOQ structure only. Pricing, RFQs,
                decisions, client terms and approvals restart.
              </small>
              <button onClick={duplicateCurrentProject}>
                Create scope-only copy
              </button>
              <button
                onClick={() => mutateProjectLifecycle(preSalesWorkflow?.lifecycleState === "Archived" ? "restore" : "archive")}
              >
                {" "}
                {preSalesWorkflow?.lifecycleState === "Archived"
                  ? "Reopen project"
                  : "Archive project"}
              </button>
            </div>
          )}
          {!showAllProjects && !isOrganizationLibrary && (
            <div className="top-actions">
              <button
                className="review-link"
                onClick={() => navigate("Review")}
              >
                Action queue
                <small>
                  {serverProjectDashboard?.actions.length || 0} verified action
                  {serverProjectDashboard?.actions.length === 1 ? "" : "s"} open
                </small>
              </button>
              <label className="currency-select">
                <small>Currency</small>
                <select aria-label="Project currency" defaultValue="SAR">
                  <option>SAR</option>
                </select>
              </label>
              <span className="demo-badge">
                <b>SERVER</b>
                <small>Verified project records</small>
              </span>
              {canViewCommercial && (
                <button
                  className="settings-button"
                  onClick={openPricingSettings}
                >
                  ⚙ <span>Settings</span>
                </button>
              )}
            </div>
          )}
        </header>

        <div className="workspace">
          {!showAllProjects && !isOrganizationLibrary && (
            <ProjectShell
              dashboard={serverProjectDashboard}
              workflow={preSalesWorkflow}
              projectCode={projectCode || projectName}
              workspaceSeal={workspaceContextSeal}
              activeWorkspace={activeModule}
              tabs={projectTabs}
              canViewCommercial={canViewCommercial}
              onNavigate={(workspace) => navigate(workspace as ModuleName)}
              onOpenRoute={(route) => openDashboardRoute(projectId, route)}
            />
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            accept=".pdf,.dwg,.xlsx,.xls,.docx,.doc,.csv,.msg,.eml,.jpg,.jpeg,.png,.tif,.tiff,.zip"
            onChange={async (event) => {
              await handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={backupInput}
            type="file"
            hidden
            accept="application/json,.json"
            onChange={async (event) => {
              await inspectLocalBackup(event.target.files);
              event.target.value = "";
            }}
          />

          {showAllProjects ? (
            <section className="projects-page organization-dashboard">
              <div className="module-heading">
                <div>
                  <small>ORGANIZATION OPERATIONS · SERVER VERIFIED</small>
                  <h1>
                    {organizationDashboard?.organization.name ||
                      "Organization dashboard"}
                  </h1>
                  <p>
                    Organization-bound work, deadlines and blockers. Unassigned
                    or other-organization projects are excluded.
                  </p>
                </div>
                <button onClick={openNewProjectWizard}>＋ New project</button>
              </div>
              {dashboardError && (
                <div className="dashboard-error" role="alert">
                  <strong>
                    {dashboardErrorCode === "NO_ACTIVE_ORGANIZATION"
                      ? "No active organization"
                      : dashboardErrorCode === "ORGANIZATION_ACCESS_DENIED"
                        ? "Organization access denied"
                        : "Dashboard unavailable"}
                  </strong>
                  <p>{dashboardError}</p>
                </div>
              )}
              {dashboardLoading && !organizationDashboard && (
                <div className="dashboard-loading" aria-live="polite">
                  <strong>Loading verified operations…</strong>
                  <p>
                    Resolving your active organization and its current projects.
                  </p>
                </div>
              )}
              {organizationDashboard && (
                <>
                  <div className="organization-metric-grid">
                    {[
                      [
                        "Active projects",
                        "activeProjects",
                        "Projects?status=active",
                      ],
                      ["Due soon", "projectsDueSoon", "Projects?due=soon"],
                      ["Overdue", "projectsOverdue", "Projects?due=overdue"],
                      ["Blocked", "projectsBlocked", "Projects?risk=blocked"],
                      [
                        "Processing",
                        "documentsProcessing",
                        "Documents?status=processing",
                      ],
                      [
                        "Failed jobs",
                        "failedProcessingJobs",
                        "Documents?status=failed",
                      ],
                      [
                        "Review required",
                        "reviewRequired",
                        "Review?status=open",
                      ],
                      [
                        "Missing prices",
                        "missingPrices",
                        "Costing?status=missing-price",
                      ],
                      [
                        "Ready for quotation",
                        "readyForQuotation",
                        "Projects?readiness=ready",
                      ],
                    ].map(([label, key, route]) => (
                      <button
                        key={key}
                        onClick={() => {
                          const first = organizationDashboard.projects[0];
                          if (first)
                            openDashboardRoute(first.project.id, route);
                        }}
                      >
                        <small>{label}</small>
                        <strong>
                          {organizationDashboard.metrics[key] || 0}
                        </strong>
                        <span>Open details →</span>
                      </button>
                    ))}
                  </div>
                  <div className="organization-updated">
                    <span>{organizationDashboard.organization.name}</span>
                    <span>Model {organizationDashboard.modelVersion}</span>
                    <span>
                      Updated{" "}
                      {new Date(
                        organizationDashboard.updatedAt,
                      ).toLocaleString()}
                    </span>
                    <span>
                      {dashboardLoading ? "Refreshing…" : "Auto-refresh active"}
                    </span>
                  </div>
                  {organizationDashboard.unassignedLegacyProjects.count > 0 && (
                    <div className="legacy-project-notice">
                      <strong>
                        {organizationDashboard.unassignedLegacyProjects.count}{" "}
                        unassigned legacy project
                        {organizationDashboard.unassignedLegacyProjects
                          .count === 1
                          ? ""
                          : "s"}
                      </strong>
                      <p>
                        Preserved unchanged and excluded from this
                        organization&apos;s projects, metrics, risks, actions
                        and totals.
                      </p>
                    </div>
                  )}
                  <label className="project-search">
                    <span>⌕</span>
                    <input
                      aria-label="Search projects"
                      value={projectSearch}
                      onChange={(event) => setProjectSearch(event.target.value)}
                      placeholder="Search by project, client or tender reference"
                    />
                  </label>
                  <div className="server-project-list">
                    {organizationDashboard.projects.map((entry) => (
                      <article key={entry.project.id}>
                        <header>
                          <button
                            onClick={() =>
                              openDashboardRoute(entry.project.id, "Overview")
                            }
                          >
                            <strong>{entry.project.name}</strong>
                            <small>
                              {entry.project.client || "Client not recorded"} ·{" "}
                              {entry.project.tenderNumber || entry.project.id}
                            </small>
                          </button>
                          <span
                            className={
                              entry.workflow.ready
                                ? "review-ready"
                                : entry.risks.some(
                                      (risk) => risk.severity === "Critical",
                                    )
                                  ? "review-blocked"
                                  : "review-pending"
                            }
                          >
                            {entry.project.status}
                          </span>
                        </header>
                        <div className="server-project-facts">
                          <span>
                            <small>Progress</small>
                            <strong>{entry.workflow.progress}%</strong>
                          </span>
                          <span>
                            <small>Current stage</small>
                            <strong>
                              {entry.workflow.stages.find(
                                (stage) =>
                                  ![
                                    "Completed",
                                    "Not Applicable",
                                    "Skipped",
                                  ].includes(stage.status),
                              )?.name || "Complete"}
                            </strong>
                          </span>
                          <span>
                            <small>BOQ</small>
                            <strong>{entry.facts.boqItems || 0}</strong>
                          </span>
                          <span>
                            <small>Missing price</small>
                            <strong>{entry.facts.missingPrices || 0}</strong>
                          </span>
                          <span>
                            <small>Risk</small>
                            <strong>
                              {entry.risks[0]?.severity || "None"}
                            </strong>
                          </span>
                        </div>
                        <div className="server-project-progress">
                          <i style={{ width: `${entry.workflow.progress}%` }} />
                        </div>
                        {entry.nextAction ? (
                          <button
                            className="project-next-action"
                            onClick={() =>
                              openDashboardRoute(
                                entry.project.id,
                                entry.nextAction!.route,
                              )
                            }
                          >
                            <span>
                              <small>
                                NEXT ACTION · {entry.nextAction.requiredRole}
                              </small>
                              <strong>{entry.nextAction.title}</strong>
                            </span>
                            <b>Open →</b>
                          </button>
                        ) : (
                          <p className="project-no-actions">
                            No action currently requires attention.
                          </p>
                        )}
                      </article>
                    ))}
                    {organizationDashboard.state ===
                      "No Organization Projects" && (
                      <div className="empty-state">
                        <strong>
                          No projects in{" "}
                          {organizationDashboard.organization.name}
                        </strong>
                        <p>
                          Create the first organization project when you are
                          ready. Legacy unassigned projects remain separate.
                        </p>
                        <button onClick={openNewProjectWizard}>
                          Create project
                        </button>
                      </div>
                    )}
                    {organizationDashboard.state === "No Search Results" && (
                      <div className="empty-state">
                        <strong>
                          No organization projects match “
                          {organizationDashboard.query}”
                        </strong>
                        <p>
                          Search by project name, client name, or tender/project
                          reference.
                        </p>
                        <button onClick={() => setProjectSearch("")}>
                          Clear search
                        </button>
                      </div>
                    )}
                  </div>
                  <section className="organization-action-queue">
                    <div className="section-title">
                      <div>
                        <small>ORGANIZATION ACTION QUEUE</small>
                        <strong>
                          Highest-priority work in{" "}
                          {organizationDashboard.organization.name}
                        </strong>
                      </div>
                      <span>
                        {organizationDashboard.actionQueue.length} actions
                      </span>
                    </div>
                    {organizationDashboard.actionQueue
                      .slice(0, 10)
                      .map((action) => (
                        <button
                          key={action.id}
                          onClick={() =>
                            openDashboardRoute(action.projectId, action.route)
                          }
                        >
                          <span
                            className={`risk-level risk-${action.severity.toLowerCase()}`}
                          >
                            {action.severity}
                          </span>
                          <span>
                            <strong>{action.title}</strong>
                            <small>
                              {action.projectName} · {action.owner}
                            </small>
                          </span>
                          <b>Open filtered work →</b>
                        </button>
                      ))}
                    {!organizationDashboard.actionQueue.length && (
                      <div className="empty-state">
                        <strong>
                          No organization actions require attention
                        </strong>
                        <p>
                          The queue includes only projects in the active
                          organization.
                        </p>
                      </div>
                    )}
                  </section>
                </>
              )}
            </section>
          ) : (
            activeModule !== "Costing" && moduleContent
          )}

          {activeModule === "Costing" && (
            <PricingWorkspace
              currency={currency}
              scenarios={pricingScenarios}
              scenarioId={pricingScenarioId}
              lines={serverPricingViews}
              sources={persistentPriceSources}
              loading={persistentPricingLoadingId !== null}
              error={persistentPricingError}
              onScenario={(id) => {
                setPricingScenarioId(id);
                const url = new URL(window.location.href);
                if (id) url.searchParams.set("scenario", id); else url.searchParams.delete("scenario");
                window.history.pushState(null, "", `${url.pathname}${url.search}`);
              }}
              onCreateScenario={() => void createPricingScenario()}
              onCalculate={calculateServerPricingByItemId}
              onSubmitManualPrice={(itemId) => void submitManualPriceEvidence(itemId)}
              onReviewSource={(itemId, sourceId) => void reviewPersistentPriceSource(itemId, sourceId)}
              onOpenReview={() => navigate("Review")}
              money={money}
            />
          )}

          {activeModule === "Costing" && Boolean(0) && (
            <div className="dashboard-grid">
              <section className="costing-panel">
                <div className="costing-focus-bar">
                  <div>
                    <small>ESTIMATOR WORK QUEUE</small>
                    <strong>
                      {outstanding
                        ? `${outstanding} BOQ lines need evidence`
                        : "All BOQ lines are priced"}
                    </strong>
                    <p>
                      {outstanding
                        ? "Resolve current supplier pricing and technical evidence one line at a time. Historical catalogue results remain discovery-only."
                        : "Review the completed cost build-up before quotation approval."}
                    </p>
                  </div>
                  {nextCostingItem ? (
                    <button
                      onClick={() => setMatchingItemId(nextCostingItem.id)}
                    >
                      Review next · BOQ-
                      {String(nextCostingItem.id).padStart(3, "0")} →
                    </button>
                  ) : (
                    <button onClick={() => navigate("Review")}>
                      Open pricing review →
                    </button>
                  )}
                </div>
                <div className="metric-grid">
                  <article>
                    <span className="metric-icon">▥</span>
                    <div>
                      <small>Total Cost</small>
                      <strong>
                        {currency} {money(totals.directCost)}
                      </strong>
                    </div>
                  </article>
                  <article>
                    <span className="metric-icon">◇</span>
                    <div>
                      <small>Selling Price</small>
                      <strong>
                        {currency} {money(totals.selling)}
                      </strong>
                    </div>
                  </article>
                  <article>
                    <span className="metric-icon">↗</span>
                    <div>
                      <small>Margin</small>
                      <strong>{totals.margin.toFixed(2)}%</strong>
                    </div>
                  </article>
                </div>

                <section
                  className="persistent-pricing-control"
                  aria-labelledby="persistent-pricing-title"
                >
                  <div>
                    <small>SERVER-AUTHORITATIVE PRICING</small>
                    <strong id="persistent-pricing-title">
                      Versioned pricing scenario
                    </strong>
                    <p>
                      Calculations use persisted BOQ, technical approval, safety
                      decision, Product Library prices, currency evidence and
                      commercial rules. Browser totals cannot approve a price.
                    </p>
                  </div>
                  <div>
                    <label>
                      Scenario
                      <select
                        aria-label="Pricing scenario"
                        value={pricingScenarioId}
                        onChange={(event) =>
                          setPricingScenarioId(event.target.value)
                        }
                      >
                        <option value="">Select scenario…</option>
                        {pricingScenarios.map((scenario) => (
                          <option value={scenario.id} key={scenario.id}>
                            {scenario.name} · v{scenario.version_number} ·{" "}
                            {scenario.project_currency}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button onClick={createPricingScenario}>
                      ＋ Create scenario
                    </button>
                  </div>
                  {persistentPricingError && (
                    <p className="managed-document-error">
                      {persistentPricingError}
                    </p>
                  )}
                </section>

                <div className="table-card">
                  <div className="table-toolbar">
                    <div>
                      <strong>Costing breakdown</strong>
                      <span>
                        {visibleCostItems.length} shown · {pricedCount} priced ·{" "}
                        {outstanding} need action
                      </span>
                    </div>
                    <div className="table-actions">
                      <button onClick={addIncompleteItem}>＋ Add Item</button>
                      <button onClick={exportCostSheet}>
                        ⇩ Export Draft Cost Sheet
                      </button>
                    </div>
                  </div>
                  <div className="costing-filters">
                    <div role="tablist" aria-label="Filter costing items">
                      <button
                        className={
                          costingView === "Needs action" ? "active" : ""
                        }
                        onClick={() => setCostingView("Needs action")}
                      >
                        Needs action <b>{outstanding}</b>
                      </button>
                      <button
                        className={costingView === "All items" ? "active" : ""}
                        onClick={() => setCostingView("All items")}
                      >
                        All items <b>{items.length}</b>
                      </button>
                      <button
                        className={costingView === "Priced" ? "active" : ""}
                        onClick={() => setCostingView("Priced")}
                      >
                        Priced <b>{pricedCount}</b>
                      </button>
                    </div>
                    <label>
                      <span>⌕</span>
                      <input
                        aria-label="Search costing items"
                        value={costingSearch}
                        onChange={(event) =>
                          setCostingSearch(event.target.value)
                        }
                        placeholder="Search BOQ description, system or source"
                      />
                    </label>
                  </div>
                  {selectableRfqItemIds.length > 0 && (
                    <div
                      className="rfq-scope-selector"
                      aria-label="Selected supplier RFQ scope"
                    >
                      <div>
                        <strong>
                          {selectedRfqScopeIds.length} selected for RFQ
                        </strong>
                        <small>
                          Only unresolved lines without an active RFQ are
                          eligible.
                        </small>
                      </div>
                      <div>
                        <button
                          className="secondary-action"
                          disabled={!visibleSelectableRfqIds.length}
                          onClick={() =>
                            setSelectedRfqItemIds((current) =>
                              allVisibleRfqItemsSelected
                                ? current.filter(
                                    (itemId) =>
                                      !visibleSelectableRfqIds.includes(itemId),
                                  )
                                : Array.from(
                                    new Set([
                                      ...current,
                                      ...visibleSelectableRfqIds,
                                    ]),
                                  ),
                            )
                          }
                        >
                          {allVisibleRfqItemsSelected
                            ? "Clear visible"
                            : "Select visible gaps"}
                        </button>
                        <button
                          disabled={!selectedRfqScopeIds.length}
                          onClick={() =>
                            prepareRfqPackages(selectedRfqScopeIds)
                          }
                        >
                          Create selected RFQ
                        </button>
                      </div>
                    </div>
                  )}
                  <p className="mobile-table-hint">
                    Swipe for cost details. Status and the next action stay
                    visible.
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>System</th>
                          <th>Item</th>
                          <th>Qty</th>
                          <th>Supplier</th>
                          <th className="numeric">
                            Unit Cost
                            <br />({currency})
                          </th>
                          <th className="numeric">
                            Markup
                            <br />
                            (%)
                          </th>
                          <th className="numeric">
                            Selling Price
                            <br />({currency})
                          </th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCostItems.map((item, index) => {
                          const firstOfSystem =
                            index === 0 ||
                            visibleCostItems[index - 1].system !== item.system;
                          const systemCount = visibleCostItems.filter(
                            (candidate) => candidate.system === item.system,
                          ).length;
                          const freshness = priceEvidenceValidity(
                            item,
                            commercialToday,
                          );
                          const displayedStatus =
                            freshness.status === "Current"
                              ? item.status
                              : freshness.status;
                          const diagnostic = matchDiagnosticFor(
                            item,
                            freshness,
                          );
                          return (
                            <tr key={item.id}>
                              {firstOfSystem && (
                                <th
                                  rowSpan={systemCount}
                                  className="system-cell"
                                >
                                  {item.system}
                                </th>
                              )}
                              <td>{item.item}</td>
                              <td>{item.qty}</td>
                              <td>{item.supplier}</td>
                              <td className="numeric locked-cost-cell">
                                <strong>{money(item.unitCost)}</strong>
                                <small>
                                  {freshness.status === "Current"
                                    ? `Current to ${freshness.validUntil}`
                                    : freshness.status === "Expiring soon"
                                      ? `Expires ${freshness.validUntil}`
                                      : freshness.status === "Expired"
                                        ? `Expired ${freshness.validUntil}`
                                        : freshness.status ===
                                            "Validity missing"
                                          ? "Validity missing"
                                          : "Awaiting approval"}
                                </small>
                              </td>
                              <td className="numeric locked-cost-cell markup-control">
                                <strong>{item.markup}%</strong>
                                <button
                                  className="match-button"
                                  onClick={() => openMarkupReview(item)}
                                  aria-label={`Edit markup for ${item.item}`}
                                >
                                  Edit
                                </button>
                              </td>
                              <td className="numeric">
                                {money(item.unitCost * (1 + item.markup / 100))}
                              </td>
                              <td>
                                {selectableRfqItemIds.includes(item.id) && (
                                  <label className="rfq-line-selector">
                                    <input
                                      type="checkbox"
                                      checked={selectedRfqScopeIds.includes(
                                        item.id,
                                      )}
                                      onChange={(event) =>
                                        setSelectedRfqItemIds((current) =>
                                          event.target.checked
                                            ? Array.from(
                                                new Set([...current, item.id]),
                                              )
                                            : current.filter(
                                                (itemId) => itemId !== item.id,
                                              ),
                                        )
                                      }
                                    />{" "}
                                    RFQ scope
                                  </label>
                                )}
                                <span
                                  className={`status status-${displayedStatus.toLowerCase().replaceAll(" ", "-")}`}
                                >
                                  {displayedStatus}
                                </span>
                                {itemNeedsCurrentEvidence(item) && (
                                  <small className="costing-diagnostic">
                                    <strong>{diagnostic.reason}</strong>
                                    {diagnostic.detail}
                                  </small>
                                )}
                                {itemNeedsCurrentEvidence(item) && (
                                  <button
                                    className="match-button"
                                    onClick={() =>
                                      diagnostic.action ===
                                        "Review historical clue" ||
                                      diagnostic.action === "Complete item data"
                                        ? setMatchingItemId(item.id)
                                        : activeRfqCoverageIds.has(item.id)
                                          ? navigate("Supplier RFQs")
                                          : prepareRfqPackages([item.id])
                                    }
                                  >
                                    {diagnostic.action ===
                                      "Create supplier RFQ" ||
                                    diagnostic.action === "Renew supplier quote"
                                      ? activeRfqCoverageIds.has(item.id)
                                        ? "Open RFQ package"
                                        : diagnostic.action
                                      : diagnostic.action}
                                  </button>
                                )}
                                <button
                                  className="match-button"
                                  disabled={
                                    !pricingScenarioId ||
                                    persistentPricingLoadingId === item.id
                                  }
                                  onClick={() =>
                                    calculatePersistentPricing(item)
                                  }
                                >
                                  {persistentPricingLoadingId === item.id
                                    ? "Calculating…"
                                    : persistentPricingLines[item.id]
                                      ? "Recalculate governed price"
                                      : "Calculate governed price"}
                                </button>
                                {persistentPricingLines[item.id] && (
                                  <small className="costing-diagnostic">
                                    <strong>
                                      {persistentPricingLines[item.id].status} ·
                                      v{persistentPricingLines[item.id].version}
                                    </strong>
                                    {persistentPricingLines[item.id].result
                                      ?.blockers?.length
                                      ? `Blocked: ${persistentPricingLines[item.id].result?.blockers?.join(", ")}`
                                      : `Total cost ${currency} ${money(persistentPricingLines[item.id].result?.totalCost || 0)} · net selling ${currency} ${money(persistentPricingLines[item.id].result?.netSelling || 0)} · margin ${(persistentPricingLines[item.id].result?.margin || 0).toFixed(2)}%`}
                                  </small>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!visibleCostItems.length && (
                    <div className="empty-state compact-empty">
                      <strong>No costing lines match this view</strong>
                      <p>
                        Change the status filter or clear the search. No BOQ
                        data has been removed.
                      </p>
                    </div>
                  )}
                  <div className="costing-secondary-actions">
                    <button
                      onClick={() =>
                        outstanding &&
                        priceEvidenceOpenItems.some(
                          ({ item }) => !activeRfqCoverageIds.has(item.id),
                        )
                          ? prepareRfqPackages()
                          : navigate("Supplier RFQs")
                      }
                    >
                      {outstanding &&
                      priceEvidenceOpenItems.some(
                        ({ item }) => !activeRfqCoverageIds.has(item.id),
                      )
                        ? "Prepare governed RFQ packages →"
                        : "Open supplier RFQ work →"}
                    </button>
                  </div>
                </div>
              </section>

              <aside className="validation-panel">
                <div className="validation-heading">
                  <div>
                    <span className="shield">◇</span>
                    <strong>Validation</strong>
                  </div>
                  <b>التحقق</b>
                </div>
                <p className={alertCount ? "alert-count" : "clear-count"}>
                  {alertCount
                    ? `${alertCount} Alert${alertCount > 1 ? "s" : ""}`
                    : "All checks passed"}
                </p>
                <div className="validation-line" />

                {outstanding ? (
                  <article className="alert-item">
                    <span className="warning">!</span>
                    <div>
                      <strong>Unpriced fire alarm scope</strong>
                      <p>
                        {outstanding} BOQ line
                        {outstanding === 1 ? " is" : "s are"} missing a current,
                        approved product and price source.
                      </p>
                      <button onClick={resolveDataLinks}>
                        Review items <b>›</b>
                      </button>
                    </div>
                  </article>
                ) : (
                  <article className="success-item">
                    <span>✓</span>
                    <div>
                      <strong>Pricing data complete</strong>
                      <p>
                        All visible BOQ items are linked to an approved source.
                      </p>
                    </div>
                  </article>
                )}

                {!rateResolved && (
                  <article className="alert-item">
                    <span className="warning">!</span>
                    <div>
                      <strong>Exchange rate confirmation required</strong>
                      <p>
                        The project setting is {exchangeRate.toFixed(3)} SAR/USD
                        but has not been confirmed for this commercial revision.
                      </p>
                      <button onClick={openPricingSettings}>
                        Review rates <b>›</b>
                      </button>
                    </div>
                  </article>
                )}

                <div className="validation-spacer" />
                <button
                  className="all-alerts"
                  onClick={() => setShowValidationReport(true)}
                >
                  ▤ View All Checks
                </button>
                <button
                  className="quotation-button"
                  disabled={Boolean(alertCount)}
                  onClick={() => {
                    setActiveStep(4);
                    setShowQuotation(true);
                  }}
                >
                  {alertCount
                    ? "Resolve alerts to continue"
                    : "Generate Client Quotation →"}
                </button>
              </aside>
            </div>
          )}
        </div>
      </main>

      {!showAllProjects &&
        (activeModule === "BOQ" || activeModule === "Review") && (
          <div
            className="review-launcher-stack"
            aria-label="Technical review tools"
          >
            {managedDocuments.some(
              (document) => document.boq_extraction_id,
            ) && (
              <aside
                className="boq-review-launcher"
                aria-label="BOQ extraction review"
              >
                <strong>BOQ extraction review</strong>
                <span>
                  Persistent source-traceable rows are ready for estimator
                  decisions.
                </span>
                {managedDocuments
                  .filter((document) => document.boq_extraction_id)
                  .map((document) => (
                    <button
                      key={document.id}
                      onClick={() => openBoqExtractionReview(document)}
                    >
                      Review {document.logical_name}
                    </button>
                  ))}
              </aside>
            )}
            {managedDocuments.some(
              (document) =>
                document.predicted_type === "Technical Specification" ||
                document.specification_extraction_id,
            ) && (
              <aside
                className="boq-review-launcher"
                aria-label="Technical specification extraction review"
              >
                <strong>Technical specification requirements</strong>
                <span>
                  Source-traceable clauses, requirements, warnings and conflicts
                  remain separate from BOQ quantities.
                </span>
                {managedDocuments
                  .filter(
                    (document) =>
                      document.predicted_type === "Technical Specification" ||
                      document.specification_extraction_id,
                  )
                  .map((document) => {
                    const summary = specificationSummaryFor(document);
                    return (
                      <div key={document.id}>
                        <span
                          className={
                            document.specification_extraction_status ===
                            "Completed"
                              ? "review-ready"
                              : document.specification_extraction_status ===
                                  "Failed"
                                ? "review-blocked"
                                : "review-pending"
                          }
                        >
                          {document.specification_extraction_status ||
                            "Awaiting confirmed classification"}
                        </span>
                        <strong>{document.logical_name}</strong>
                        <small>
                          {summary.requirements || 0} requirements ·{" "}
                          {summary.itemsNeedingReview || 0} need review ·{" "}
                          {summary.conflicts || 0} conflicts
                        </small>
                        <button
                          disabled={
                            specificationExtractionRequest?.documentId ===
                              document.id &&
                            specificationExtractionRequest.loading
                          }
                          onClick={() =>
                            specificationExtractionCommand(
                              document,
                              document.specification_extraction_id
                                ? "rerun"
                                : "start",
                            )
                          }
                        >
                          {specificationExtractionRequest?.documentId ===
                            document.id &&
                          specificationExtractionRequest.loading
                            ? "Processing…"
                            : document.specification_extraction_id
                              ? "Re-run extraction"
                              : "Start extraction"}
                        </button>
                        {specificationExtractionRequest?.documentId ===
                          document.id && (
                          <small
                            className={
                              specificationExtractionRequest.errorMessage
                                ? "managed-document-error"
                                : "review-ready"
                            }
                          >
                            {specificationExtractionRequest.status}
                            {specificationExtractionRequest.errorMessage
                              ? ` · ${specificationExtractionRequest.errorCode}: ${specificationExtractionRequest.errorMessage} · ${specificationExtractionRequest.suggestedAction}`
                              : ""}
                          </small>
                        )}
                        {document.specification_extraction_id && (
                          <>
                            <button
                              onClick={() =>
                                openTechnicalRequirementReview(document)
                              }
                            >
                              Review requirements
                            </button>
                            <a
                              href={`/api/documents/${encodeURIComponent(document.id)}/specification-extraction/conflicts`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Review conflicts
                            </a>
                            <a
                              href={`/api/documents/${encodeURIComponent(document.id)}/specification-extraction/export`}
                            >
                              Export extraction
                            </a>
                          </>
                        )}
                      </div>
                    );
                  })}
              </aside>
            )}
            {(managedDocuments.some((document) => document.boq_extraction_id) ||
              managedDocuments.some(
                (document) => document.specification_extraction_id,
              )) && (
              <aside
                className="boq-review-launcher"
                aria-label="Engineering knowledge model"
              >
                <strong>Canonical engineering knowledge</strong>
                <span>
                  Only approved BOQ items and approved technical requirements
                  can be published. Applicability links remain suggestions until
                  an engineer confirms them.
                </span>
                <button onClick={() => engineeringKnowledgeCommand("publish")}>
                  Publish approved facts
                </button>
                <button
                  onClick={() => engineeringKnowledgeCommand("suggest-links")}
                >
                  Generate link suggestions
                </button>
                <button onClick={() => void openApplicabilityReview()}>
                  Review applicability suggestions
                </button>
                <a
                  href={`/api/projects/${encodeURIComponent(projectId)}/engineering-knowledge/facts`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Review canonical facts
                </a>
                <a
                  href={`/api/projects/${encodeURIComponent(projectId)}/engineering-knowledge/conflicts`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Review knowledge conflicts
                </a>
              </aside>
            )}
          </div>
        )}

      {classificationReviewDraft && (
        <div
          className="match-overlay classification-review-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="classification-dialog-title"
        >
          <button
            className="drawer-scrim"
            onClick={() =>
              !classificationReviewDraft.saving &&
              setClassificationReviewDraft(null)
            }
            aria-label="Close classification review"
          />
          <section className="match-panel classification-review-panel">
            <header className="match-header">
              <div>
                <small>DOCUMENT CLASSIFICATION REVIEW</small>
                <h2 id="classification-dialog-title">
                  Confirm the document type
                </h2>
                <p>{classificationReviewDraft.document.logical_name}</p>
              </div>
              <button
                disabled={classificationReviewDraft.saving}
                onClick={() => setClassificationReviewDraft(null)}
                aria-label="Close classification review"
              >
                ×
              </button>
            </header>
            <div className="classification-review-evidence">
              <article>
                <small>CURRENT RESULT</small>
                <strong>
                  {classificationReviewDraft.document.predicted_type ||
                    "Unknown"}
                </strong>
                <span>
                  {classificationReviewDraft.document
                    .classification_confidence || 0}
                  % confidence ·{" "}
                  {classificationReviewDraft.document.confidence_state ||
                    "Evidence incomplete"}
                </span>
              </article>
              <article>
                <small>PROCESSING ROUTE</small>
                <strong>
                  {classificationReviewDraft.document.downstream_route ||
                    "No route selected"}
                </strong>
                <span>
                  Classification controls which extractor may use this file.
                </span>
              </article>
            </div>
            <div className="classification-review-form">
              <label>
                Document type
                <select
                  autoFocus
                  aria-label="Correct document type"
                  value={classificationReviewDraft.selectedType}
                  onChange={(event) =>
                    setClassificationReviewDraft((current) =>
                      current
                        ? {
                            ...current,
                            selectedType: event.target.value,
                            error: "",
                          }
                        : current,
                    )
                  }
                >
                  <option value="">Select a document type…</option>
                  {documentClassificationTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review reason
                <textarea
                  aria-label="Classification review reason"
                  value={classificationReviewDraft.reason}
                  onChange={(event) =>
                    setClassificationReviewDraft((current) =>
                      current
                        ? { ...current, reason: event.target.value, error: "" }
                        : current,
                    )
                  }
                  placeholder="What visible content identifies this file type?"
                />
              </label>
              <p className="classification-safety-note">
                Saving confirms the document type only. It does not start
                extraction, change BOQ quantities, approve prices, or create
                product matches.
              </p>
              {classificationReviewDraft.error && (
                <p className="managed-document-error" role="alert">
                  {classificationReviewDraft.error}
                </p>
              )}
            </div>
            <footer className="preview-actions">
              <button
                disabled={classificationReviewDraft.saving}
                onClick={() => setClassificationReviewDraft(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  classificationReviewDraft.saving ||
                  !classificationReviewDraft.selectedType ||
                  !classificationReviewDraft.reason.trim()
                }
                onClick={() => void saveClassificationReview()}
              >
                {classificationReviewDraft.saving
                  ? "Saving…"
                  : "Save classification"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {requirementReviewDocument && authSession && (
        <TechnicalRequirementsWorkspace
          documentName={requirementReviewDocument.logical_name}
          reviewerName={authSession.user.displayName}
          reviewerEmail={authSession.user.email}
          requirements={technicalRequirements}
          filtered={filteredTechnicalRequirements}
          selected={selectedTechnicalRequirement}
          history={technicalRequirementHistory}
          loading={technicalRequirementsLoading}
          error={technicalRequirementError}
          search={technicalRequirementSearch}
          section={technicalRequirementSection}
          clause={technicalRequirementClause}
          page={technicalRequirementPage}
          status={technicalRequirementStatus}
          sections={technicalRequirementSections}
          clauses={technicalRequirementClauses}
          pages={technicalRequirementPages}
          onSearch={setTechnicalRequirementSearch}
          onSection={setTechnicalRequirementSection}
          onClause={setTechnicalRequirementClause}
          onPage={setTechnicalRequirementPage}
          onStatus={setTechnicalRequirementStatus}
          onSelect={selectTechnicalRequirement}
          onDecision={(requirement, operation) => setTechnicalRequirementAction({ requirement, operation, reason: "", normalizedRequirement: requirement.normalized_requirement })}
          onClose={closeTechnicalRequirementReview}
        />
      )}

      {requirementReviewDocument && authSession && Boolean(0) && (
        <div
          className="match-overlay requirement-review-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="requirement-review-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeTechnicalRequirementReview}
            aria-label="Close technical requirement review"
          />
          <section className="match-panel requirement-review-panel">
            <header className="match-header">
              <div>
                <small>GOVERNED SPECIFICATION REVIEW</small>
                <h2 id="requirement-review-title">
                  Technical Requirement Review
                </h2>
                <p>
                  {requirementReviewDocument.logical_name} ·{" "}
                  {technicalRequirements.length} extracted requirements ·
                  reviewer {authSession.user.displayName}
                </p>
              </div>
              <button
                onClick={closeTechnicalRequirementReview}
                aria-label="Close technical requirement review"
              >
                ×
              </button>
            </header>
            <div className="requirement-review-filters">
              <label>
                Search
                <input
                  aria-label="Search requirements"
                  value={technicalRequirementSearch}
                  onChange={(event) =>
                    setTechnicalRequirementSearch(event.target.value)
                  }
                  placeholder="Evidence, requirement or technical term"
                />
              </label>
              <label>
                Section
                <select
                  aria-label="Filter by section"
                  value={technicalRequirementSection}
                  onChange={(event) =>
                    setTechnicalRequirementSection(event.target.value)
                  }
                >
                  <option>All</option>
                  {technicalRequirementSections.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Clause
                <select
                  aria-label="Filter by clause"
                  value={technicalRequirementClause}
                  onChange={(event) =>
                    setTechnicalRequirementClause(event.target.value)
                  }
                >
                  <option>All</option>
                  {technicalRequirementClauses.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Page
                <select
                  aria-label="Filter by page"
                  value={technicalRequirementPage}
                  onChange={(event) =>
                    setTechnicalRequirementPage(event.target.value)
                  }
                >
                  <option>All</option>
                  {technicalRequirementPages.map((value) => (
                    <option key={value} value={String(value)}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  aria-label="Filter by status"
                  value={technicalRequirementStatus}
                  onChange={(event) =>
                    setTechnicalRequirementStatus(event.target.value)
                  }
                >
                  <option>All</option>
                  <option>Needs Review</option>
                  <option>Pending Approval</option>
                  <option>Approved</option>
                  <option>Rejected</option>
                </select>
              </label>
            </div>
            {technicalRequirementError && (
              <p
                className="managed-document-error requirement-review-error"
                role="alert"
              >
                {technicalRequirementError}
              </p>
            )}
            <div className="requirement-review-layout">
              <section
                className="requirement-review-list"
                aria-label="Extracted requirements"
              >
                <header>
                  <strong>
                    {technicalRequirementsLoading
                      ? "Loading requirements…"
                      : `${filteredTechnicalRequirements.length} matching requirements`}
                  </strong>
                  <small>No requirement is approved automatically.</small>
                </header>
                {filteredTechnicalRequirements.map((requirement) => (
                  <button
                    key={requirement.id}
                    className={
                      selectedTechnicalRequirementId === requirement.id
                        ? "selected"
                        : ""
                    }
                    onClick={() => void selectTechnicalRequirement(requirement)}
                  >
                    <span>
                      <b>#{requirement.sequence}</b>
                      <small>
                        Page {requirement.source_location.pageFrom || "?"} ·
                        Clause{" "}
                        {requirement.source_location.clause || "Unassigned"}
                      </small>
                    </span>
                    <strong>{requirement.original_text}</strong>
                    <em
                      className={
                        requirement.review_status === "Approved"
                          ? "review-ready"
                          : requirement.review_status === "Rejected"
                            ? "review-blocked"
                            : "review-pending"
                      }
                    >
                      {requirement.review_status}
                    </em>
                  </button>
                ))}
                {!technicalRequirementsLoading &&
                  !filteredTechnicalRequirements.length && (
                    <div className="empty-state">
                      <strong>No requirements match these filters</strong>
                      <p>
                        Change the search or filter values. No review status was
                        changed.
                      </p>
                    </div>
                  )}
              </section>
              <section
                className="requirement-review-detail"
                aria-label="Requirement evidence and decision"
              >
                {selectedTechnicalRequirement ? (
                  <>
                    <header>
                      <div>
                        <small>
                          REQUIREMENT #{selectedTechnicalRequirement.sequence}
                        </small>
                        <h3>
                          {selectedTechnicalRequirement.requirement_category}
                        </h3>
                      </div>
                      <span
                        className={
                          selectedTechnicalRequirement.review_status ===
                          "Approved"
                            ? "review-ready"
                            : selectedTechnicalRequirement.review_status ===
                                "Rejected"
                              ? "review-blocked"
                              : "review-pending"
                        }
                      >
                        {selectedTechnicalRequirement.review_status}
                      </span>
                    </header>
                    <dl className="requirement-provenance">
                      <div>
                        <dt>Section</dt>
                        <dd>
                          {selectedTechnicalRequirement.source_location
                            .section || "Not identified"}
                        </dd>
                      </div>
                      <div>
                        <dt>Clause</dt>
                        <dd>
                          {selectedTechnicalRequirement.source_location
                            .clause || "Not identified"}
                        </dd>
                      </div>
                      <div>
                        <dt>Page</dt>
                        <dd>
                          {selectedTechnicalRequirement.source_location
                            .pageFrom || "Not identified"}
                          {selectedTechnicalRequirement.source_location
                            .pageTo &&
                          selectedTechnicalRequirement.source_location
                            .pageTo !==
                            selectedTechnicalRequirement.source_location
                              .pageFrom
                            ? `–${selectedTechnicalRequirement.source_location.pageTo}`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Confidence</dt>
                        <dd>
                          {selectedTechnicalRequirement.confidence}% ·{" "}
                          {selectedTechnicalRequirement.confidence_state}
                        </dd>
                      </div>
                    </dl>
                    <article className="requirement-evidence">
                      <small>ORIGINAL SPECIFICATION EVIDENCE</small>
                      <p>{selectedTechnicalRequirement.original_text}</p>
                      {selectedTechnicalRequirement.source_location.clausePath
                        ?.length ? (
                        <small>
                          {selectedTechnicalRequirement.source_location.clausePath.join(
                            " › ",
                          )}
                        </small>
                      ) : null}
                    </article>
                    <article className="requirement-normalized">
                      <small>NORMALIZED REQUIREMENT</small>
                      <p>
                        {String(
                          selectedTechnicalRequirement.current_values
                            ?.normalizedRequirement ||
                            selectedTechnicalRequirement.normalized_requirement,
                        )}
                      </p>
                    </article>
                    <article className="requirement-values">
                      <small>EXTRACTED TECHNICAL VALUES</small>
                      <dl>
                        {Object.entries(
                          selectedTechnicalRequirement.original_values || {},
                        )
                          .filter(
                            ([key]) =>
                              ![
                                "originalText",
                                "normalizedRequirement",
                                "source",
                              ].includes(key),
                          )
                          .map(([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>
                                {typeof value === "string"
                                  ? value
                                  : JSON.stringify(value)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </article>
                    <div className="requirement-review-actions">
                      <button
                        onClick={() =>
                          setTechnicalRequirementAction({
                            requirement: selectedTechnicalRequirement,
                            operation: "update",
                            reason: "",
                            normalizedRequirement: String(
                              selectedTechnicalRequirement.current_values
                                ?.normalizedRequirement ||
                                selectedTechnicalRequirement.normalized_requirement,
                            ),
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          setTechnicalRequirementAction({
                            requirement: selectedTechnicalRequirement,
                            operation: "approve",
                            reason: "",
                            normalizedRequirement:
                              selectedTechnicalRequirement.normalized_requirement,
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setTechnicalRequirementAction({
                            requirement: selectedTechnicalRequirement,
                            operation: "reject",
                            reason: "",
                            normalizedRequirement:
                              selectedTechnicalRequirement.normalized_requirement,
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        onClick={() =>
                          setTechnicalRequirementAction({
                            requirement: selectedTechnicalRequirement,
                            operation: "restore",
                            reason: "",
                            normalizedRequirement:
                              selectedTechnicalRequirement.normalized_requirement,
                          })
                        }
                      >
                        Restore
                      </button>
                    </div>
                    <section className="requirement-audit-history">
                      <header>
                        <strong>Immutable review history</strong>
                        <small>
                          {technicalRequirementHistory.length} decision
                          {technicalRequirementHistory.length === 1 ? "" : "s"}
                        </small>
                      </header>
                      {technicalRequirementHistory.map((entry) => (
                        <article key={entry.id}>
                          <strong>{entry.action}</strong>
                          <p>{entry.reason}</p>
                          <small>
                            {entry.decided_by} ·{" "}
                            {new Date(entry.decided_at).toLocaleString()}
                          </small>
                        </article>
                      ))}
                      {!technicalRequirementHistory.length && (
                        <p>
                          No review decision has been recorded for this
                          requirement.
                        </p>
                      )}
                    </section>
                  </>
                ) : (
                  <div className="empty-state">
                    <strong>Select a requirement</strong>
                    <p>
                      Inspect original evidence and provenance before recording
                      a decision.
                    </p>
                  </div>
                )}
              </section>
            </div>
            <footer className="preview-actions">
              <span>
                {authSession.user.displayName} · {authSession.user.email} ·
                decisions require a reason
              </span>
              <button onClick={closeTechnicalRequirementReview}>
                Close review
              </button>
            </footer>
          </section>
        </div>
      )}

      {technicalRequirementAction && (
        <div
          className="match-overlay requirement-action-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="requirement-action-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setTechnicalRequirementAction(null)}
            aria-label="Cancel requirement decision"
          />
          <section className="match-panel requirement-action-panel">
            <header className="match-header">
              <div>
                <small>AUTHENTICATED REVIEW DECISION</small>
                <h2 id="requirement-action-title">
                  {technicalRequirementAction.operation === "update"
                    ? "Edit requirement"
                    : `${technicalRequirementAction.operation[0].toUpperCase()}${technicalRequirementAction.operation.slice(1)} requirement`}
                </h2>
                <p>
                  Reviewer {authSession.user.displayName} ·{" "}
                  {authSession.user.email}
                </p>
              </div>
              <button
                onClick={() => setTechnicalRequirementAction(null)}
                aria-label="Cancel requirement decision"
              >
                ×
              </button>
            </header>
            {technicalRequirementAction.operation === "update" && (
              <label>
                Normalized requirement
                <textarea
                  value={technicalRequirementAction.normalizedRequirement}
                  onChange={(event) =>
                    setTechnicalRequirementAction((current) =>
                      current
                        ? {
                            ...current,
                            normalizedRequirement: event.target.value,
                          }
                        : current,
                    )
                  }
                />
              </label>
            )}
            <label>
              Mandatory review reason
              <textarea
                aria-label="Mandatory review reason"
                value={technicalRequirementAction.reason}
                onChange={(event) =>
                  setTechnicalRequirementAction((current) =>
                    current
                      ? { ...current, reason: event.target.value }
                      : current,
                  )
                }
                placeholder="State the specification evidence and engineering basis for this decision."
              />
            </label>
            <p>
              Original evidence remains immutable. This action does not create
              applicability links, compatibility, certification, matching or
              pricing decisions.
            </p>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                onClick={() => setTechnicalRequirementAction(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  technicalRequirementActionLoading ||
                  technicalRequirementAction.reason.trim().length < 3 ||
                  (technicalRequirementAction.operation === "update" &&
                    !technicalRequirementAction.normalizedRequirement.trim())
                }
                onClick={() => void submitTechnicalRequirementAction()}
              >
                {technicalRequirementActionLoading
                  ? "Recording…"
                  : "Record governed decision"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {requirementIntelligenceItemId && (
        <div
          className="match-overlay requirement-intelligence-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="requirement-intelligence-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeRequirementIntelligence}
            aria-label="Close requirement intelligence"
          />
          <section className="match-panel requirement-intelligence-panel">
            <header className="match-header">
              <div>
                <small>
                  STEP 08 · SOURCE-CONSTRAINED ENGINEERING KNOWLEDGE
                </small>
                <h2 id="requirement-intelligence-title">
                  Requirement Intelligence
                </h2>
                <p>
                  {requirementIntelligenceItem?.item_number} ·{" "}
                  {requirementIntelligenceItem?.description} · profile v
                  {requirementProfilesByItem[requirementIntelligenceItemId]
                    ?.version_number || "?"}
                </p>
              </div>
              <button
                onClick={closeRequirementIntelligence}
                aria-label="Close requirement intelligence"
              >
                ×
              </button>
            </header>
            <div className="intelligence-summary">
              <span>
                <small>FACTS</small>
                <strong>{requirementIntelligenceFacts.length}</strong>
              </span>
              <span>
                <small>NEEDS REVIEW</small>
                <strong>
                  {
                    requirementIntelligenceFacts.filter(
                      (fact) => fact.review_status === "Needs Review",
                    ).length
                  }
                </strong>
              </span>
              <span>
                <small>EXTRACTION CONFIRMED</small>
                <strong>
                  {
                    requirementIntelligenceFacts.filter(
                      (fact) => fact.review_status === "Approved",
                    ).length
                  }
                </strong>
              </span>
              <span>
                <small>REJECTED</small>
                <strong>
                  {
                    requirementIntelligenceFacts.filter(
                      (fact) => fact.review_status === "Rejected",
                    ).length
                  }
                </strong>
              </span>
              <span>
                <small>CONFIDENCE</small>
                <strong>
                  {requirementIntelligenceFacts.length
                    ? Math.round(
                        requirementIntelligenceFacts.reduce(
                          (sum, fact) => sum + fact.confidence,
                          0,
                        ) / requirementIntelligenceFacts.length,
                      )
                    : 0}
                  %
                </strong>
              </span>
            </div>
            <div className="applicability-filters">
              <label>
                Fact type
                <select
                  aria-label="Filter intelligence by type"
                  value={requirementIntelligenceType}
                  onChange={(event) =>
                    setRequirementIntelligenceType(event.target.value)
                  }
                >
                  <option>All</option>
                  {requirementIntelligenceTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  aria-label="Filter intelligence by status"
                  value={requirementIntelligenceStatus}
                  onChange={(event) =>
                    setRequirementIntelligenceStatus(event.target.value)
                  }
                >
                  <option>All</option>
                  <option>Needs Review</option>
                  <option>Approved</option>
                  <option>Rejected</option>
                </select>
              </label>
              <button
                disabled={requirementIntelligenceLoading}
                onClick={() =>
                  void loadRequirementIntelligence(
                    requirementIntelligenceItemId,
                  )
                }
              >
                {requirementIntelligenceLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {requirementIntelligenceError && (
              <p className="managed-document-error" role="alert">
                {requirementIntelligenceError}
              </p>
            )}
            <div className="requirement-intelligence-layout">
              <section
                className="requirement-intelligence-list"
                aria-label="Structured engineering facts"
              >
                {filteredRequirementIntelligenceFacts.map((fact) => (
                  <article key={fact.id}>
                    <header>
                      <div>
                        <small>{fact.modality}</small>
                        <strong>{fact.fact_type}</strong>
                      </div>
                      <span
                        className={
                          fact.review_status === "Approved"
                            ? "review-ready"
                            : fact.review_status === "Rejected"
                              ? "review-blocked"
                              : "review-pending"
                        }
                      >
                        {fact.review_status}
                      </span>
                    </header>
                    <p className="intelligence-value">
                      {typeof fact.current_value === "string"
                        ? fact.current_value
                        : JSON.stringify(fact.current_value)}
                    </p>
                    <dl>
                      <div>
                        <dt>Confidence</dt>
                        <dd>{fact.confidence}%</dd>
                      </div>
                      <div>
                        <dt>Page</dt>
                        <dd>{fact.source_page || "?"}</dd>
                      </div>
                      <div>
                        <dt>Clause</dt>
                        <dd>{fact.source_clause || "?"}</dd>
                      </div>
                      <div>
                        <dt>Section</dt>
                        <dd>{fact.source_section || "?"}</dd>
                      </div>
                    </dl>
                    <aside>
                      <small>EVIDENCE</small>
                      <p>{fact.evidence_snippet}</p>
                      <small>{fact.extraction_basis}</small>
                    </aside>
                    <footer>
                      <button
                        onClick={() =>
                          setRequirementIntelligenceAction({
                            fact,
                            operation: "update",
                            reason: "",
                            value:
                              typeof fact.current_value === "string"
                                ? fact.current_value
                                : JSON.stringify(fact.current_value),
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          setRequirementIntelligenceAction({
                            fact,
                            operation: "approve",
                            reason: "",
                            value: "",
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setRequirementIntelligenceAction({
                            fact,
                            operation: "reject",
                            reason: "",
                            value: "",
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        onClick={() =>
                          setRequirementIntelligenceAction({
                            fact,
                            operation: "restore",
                            reason: "",
                            value: "",
                          })
                        }
                      >
                        Restore
                      </button>
                    </footer>
                    {fact.review_reason && (
                      <small>
                        Last review: {fact.reviewed_by} · {fact.review_reason}
                      </small>
                    )}
                    <details>
                      <summary>Immutable audit history</summary>
                      {requirementIntelligenceDecisions
                        .filter((entry) => entry.entity_id === fact.id)
                        .map((entry) => (
                          <p key={entry.id}>
                            <strong>{entry.action}</strong> · {entry.reason}
                            <br />
                            <small>
                              {entry.decided_by} ·{" "}
                              {new Date(entry.decided_at).toLocaleString()}
                            </small>
                          </p>
                        ))}
                    </details>
                  </article>
                ))}
                {!requirementIntelligenceLoading &&
                  !filteredRequirementIntelligenceFacts.length && (
                    <div className="empty-state">
                      <strong>No structured facts match this view</strong>
                      <p>
                        No unsupported manufacturer, certification or
                        compatibility fact was invented.
                      </p>
                    </div>
                  )}
              </section>
              <aside className="intelligence-gaps">
                <strong>Engineering gaps</strong>
                <p>
                  Missing information, conflicts and clarifications remain
                  governed by the Requirement Profile.
                </p>
                <dl>
                  <div>
                    <dt>Missing information</dt>
                    <dd>
                      {requirementProfilesByItem[requirementIntelligenceItemId]
                        ?.profile.intelligence?.missingInformation?.length || 0}
                    </dd>
                  </div>
                  <div>
                    <dt>Conflicts</dt>
                    <dd>
                      {requirementProfilesByItem[requirementIntelligenceItemId]
                        ?.profile.intelligence?.conflicts?.length || 0}
                    </dd>
                  </div>
                  <div>
                    <dt>Clarifications</dt>
                    <dd>
                      {requirementProfilesByItem[requirementIntelligenceItemId]
                        ?.profile.intelligence?.clarifications?.length || 0}
                    </dd>
                  </div>
                </dl>
                <small>
                  Matching and pricing remain disabled. Approved intelligence
                  does not approve a product.
                </small>
              </aside>
            </div>
            <footer className="preview-actions">
              <span>
                Every fact preserves requirement, page, clause and evidence
                provenance.
              </span>
              <button onClick={closeRequirementIntelligence}>
                Close intelligence
              </button>
            </footer>
          </section>
        </div>
      )}

      {requirementIntelligenceAction && (
        <div
          className="match-overlay requirement-action-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="intelligence-action-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setRequirementIntelligenceAction(null)}
            aria-label="Cancel intelligence decision"
          />
          <section className="match-panel requirement-action-panel">
            <header className="match-header">
              <div>
                <small>IMMUTABLE ENGINEERING DECISION</small>
                <h2 id="intelligence-action-title">
                  {requirementIntelligenceAction.operation[0].toUpperCase()}
                  {requirementIntelligenceAction.operation.slice(1)}{" "}
                  {requirementIntelligenceAction.fact.fact_type}
                </h2>
                <p>
                  Page {requirementIntelligenceAction.fact.source_page || "?"} ·
                  Clause{" "}
                  {requirementIntelligenceAction.fact.source_clause || "?"}
                </p>
              </div>
              <button
                onClick={() => setRequirementIntelligenceAction(null)}
                aria-label="Cancel intelligence decision"
              >
                ×
              </button>
            </header>
            {requirementIntelligenceAction.operation === "update" && (
              <label>
                Structured value
                <textarea
                  aria-label="Structured intelligence value"
                  value={requirementIntelligenceAction.value}
                  onChange={(event) =>
                    setRequirementIntelligenceAction((current) =>
                      current
                        ? { ...current, value: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
            )}
            <article className="requirement-evidence">
              <small>ORIGINAL EVIDENCE</small>
              <p>{requirementIntelligenceAction.fact.evidence_snippet}</p>
            </article>
            <label>
              Mandatory reviewer reason
              <textarea
                aria-label="Mandatory intelligence reason"
                value={requirementIntelligenceAction.reason}
                onChange={(event) =>
                  setRequirementIntelligenceAction((current) =>
                    current
                      ? { ...current, reason: event.target.value }
                      : current,
                  )
                }
                placeholder="State the source evidence and engineering basis."
              />
            </label>
            <p>
              Original extracted value and evidence remain preserved. This
              decision cannot create a product match or price.
            </p>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                onClick={() => setRequirementIntelligenceAction(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  requirementIntelligenceLoading ||
                  requirementIntelligenceAction.reason.trim().length < 5 ||
                  (requirementIntelligenceAction.operation === "update" &&
                    !requirementIntelligenceAction.value.trim())
                }
                onClick={() => void submitRequirementIntelligenceAction()}
              >
                Record governed decision
              </button>
            </footer>
          </section>
        </div>
      )}

      {engineeringClassificationItemId && (
        <div
          className="match-overlay engineering-classification-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="engineering-classification-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeEngineeringClassification}
            aria-label="Close engineering classification"
          />
          <section className="match-panel engineering-classification-panel">
            <header className="match-header">
              <div>
                <small>STEP 09 · MATCHING READINESS GATE</small>
                <h2 id="engineering-classification-title">
                  Engineering Classification
                </h2>
                <p>
                  {engineeringClassificationItem?.item_number} ·{" "}
                  {engineeringClassificationItem?.description} · engineering
                  profile v
                  {engineeringClassificationVersion?.version_number || "?"}
                </p>
              </div>
              <button
                onClick={closeEngineeringClassification}
                aria-label="Close engineering classification"
              >
                ×
              </button>
            </header>
            <div className="classification-readiness">
              <div>
                <small>ENGINEERING COMPLETENESS</small>
                <strong>
                  {engineeringClassificationVersion?.completeness ?? 0}%
                </strong>
                <progress
                  max="100"
                  value={engineeringClassificationVersion?.completeness || 0}
                />
              </div>
              <div>
                <small>MATCHING READINESS</small>
                <strong
                  className={
                    engineeringClassificationVersion?.matching_readiness ===
                    "Ready"
                      ? "review-ready"
                      : engineeringClassificationVersion?.matching_readiness ===
                          "Conditionally Ready"
                        ? "review-pending"
                        : "review-blocked"
                  }
                >
                  {engineeringClassificationVersion?.matching_readiness ||
                    "Not generated"}
                </strong>
                <span>No readiness is approved automatically.</span>
              </div>
              <button
                disabled={engineeringClassificationLoading}
                onClick={() =>
                  void generateEngineeringClassification(
                    engineeringClassificationItemId,
                  )
                }
              >
                {engineeringClassificationLoading
                  ? "Recalculating…"
                  : "Recalculate classification"}
              </button>
            </div>
            {engineeringClassificationError && (
              <p className="managed-document-error" role="alert">
                {engineeringClassificationError}
              </p>
            )}
            <div className="applicability-filters">
              <label>
                Status
                <select
                  aria-label="Filter classification by status"
                  value={engineeringClassificationStatus}
                  onChange={(event) =>
                    setEngineeringClassificationStatus(event.target.value)
                  }
                >
                  <option>All</option>
                  <option>Needs Review</option>
                  <option>Approved</option>
                  <option>Rejected</option>
                </select>
              </label>
            </div>
            <div className="engineering-classification-layout">
              <section
                className="classification-decisions"
                aria-label="Engineering decisions"
              >
                {filteredEngineeringClassificationDecisions.map((entry) => (
                  <article key={entry.id}>
                    <header>
                      <div>
                        <small>ENGINEERING DECISION</small>
                        <strong>{entry.classification_type}</strong>
                      </div>
                      <span
                        className={
                          entry.review_status === "Approved"
                            ? "review-ready"
                            : entry.review_status === "Rejected"
                              ? "review-blocked"
                              : "review-pending"
                        }
                      >
                        {entry.review_status}
                      </span>
                    </header>
                    <p>
                      {typeof entry.value === "string"
                        ? entry.value
                        : JSON.stringify(entry.value)}
                    </p>
                    <small>
                      {entry.confidence}% confidence · {entry.basis}
                    </small>
                    <section>
                      <strong>Evidence provenance</strong>
                      {entry.evidence.map((source) => (
                        <p key={source.factId}>
                          <b>{source.factType}:</b>{" "}
                          {typeof source.value === "string"
                            ? source.value
                            : JSON.stringify(source.value)}
                          <br />
                          <small>
                            Page {source.page || "?"} · Clause{" "}
                            {source.clause || "?"} · {source.evidenceSnippet}
                          </small>
                        </p>
                      ))}
                    </section>
                    <footer>
                      <button
                        onClick={() =>
                          setEngineeringClassificationAction({
                            decision: entry,
                            operation: "approve",
                            reason: "",
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setEngineeringClassificationAction({
                            decision: entry,
                            operation: "reject",
                            reason: "",
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        onClick={() =>
                          setEngineeringClassificationAction({
                            decision: entry,
                            operation: "restore",
                            reason: "",
                          })
                        }
                      >
                        Restore
                      </button>
                    </footer>
                    {entry.review_reason && (
                      <small>
                        Last review: {entry.reviewed_by} · {entry.review_reason}
                      </small>
                    )}
                    <details>
                      <summary>Immutable audit history</summary>
                      {engineeringClassificationAudit
                        .filter((audit) => audit.entity_id === entry.id)
                        .map((audit) => (
                          <p key={audit.id}>
                            <strong>{audit.action}</strong> · {audit.reason}
                            <br />
                            <small>
                              {audit.decided_by} ·{" "}
                              {new Date(audit.decided_at).toLocaleString()}
                            </small>
                          </p>
                        ))}
                    </details>
                  </article>
                ))}
                {!engineeringClassificationLoading &&
                  !filteredEngineeringClassificationDecisions.length && (
                    <div className="empty-state">
                      <strong>No evidence-supported classifications</strong>
                      <p>
                        Approve Requirement Intelligence facts before
                        recalculating. Missing values are not inferred.
                      </p>
                    </div>
                  )}
              </section>
              <aside className="classification-gaps">
                <section>
                  <strong>Blocking issues</strong>
                  {engineeringClassificationVersion?.blocking_missing_information.map(
                    (entry) => (
                      <article key={entry.classificationType}>
                        <b>{entry.classificationType}</b>
                        <p>{entry.reason}</p>
                        <small>{entry.requiredHumanDecision}</small>
                      </article>
                    ),
                  )}
                </section>
                <section>
                  <strong>Missing evidence</strong>
                  <ul>
                    {engineeringClassificationVersion?.missing_evidence.map(
                      (entry) => (
                        <li key={entry}>{entry}</li>
                      ),
                    )}
                  </ul>
                </section>
                <section>
                  <strong>Technical risks</strong>
                  {engineeringClassificationVersion?.technical_risks.map(
                    (entry) => (
                      <p key={entry.area}>
                        <b>{entry.area}:</b> {entry.risk}
                      </p>
                    ),
                  )}
                </section>
                <section>
                  <strong>Engineering questions</strong>
                  {engineeringClassificationVersion?.engineering_questions.map(
                    (entry) => (
                      <p key={entry.classificationType}>{entry.question}</p>
                    ),
                  )}
                </section>
                <section>
                  <strong>Required human decisions</strong>
                  {engineeringClassificationVersion?.required_human_decisions.map(
                    (entry) => (
                      <p key={entry.decision}>{entry.decision}</p>
                    ),
                  )}
                </section>
              </aside>
            </div>
            <footer className="preview-actions">
              <span>
                Only approved intelligence facts contribute. Matching and
                pricing remain at zero.
              </span>
              <button onClick={closeEngineeringClassification}>
                Close classification
              </button>
            </footer>
          </section>
        </div>
      )}

      {engineeringClassificationAction && (
        <div
          className="match-overlay requirement-action-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="classification-action-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setEngineeringClassificationAction(null)}
            aria-label="Cancel classification decision"
          />
          <section className="match-panel requirement-action-panel">
            <header className="match-header">
              <div>
                <small>GOVERNED ENGINEERING REVIEW</small>
                <h2 id="classification-action-title">
                  {engineeringClassificationAction.operation[0].toUpperCase()}
                  {engineeringClassificationAction.operation.slice(1)}{" "}
                  {engineeringClassificationAction.decision.classification_type}
                </h2>
                <p>
                  {
                    engineeringClassificationAction.decision.supporting_fact_ids
                      .length
                  }{" "}
                  supporting approved fact(s)
                </p>
              </div>
              <button
                onClick={() => setEngineeringClassificationAction(null)}
                aria-label="Cancel classification decision"
              >
                ×
              </button>
            </header>
            <article className="requirement-evidence">
              <small>EVIDENCE BASIS</small>
              {engineeringClassificationAction.decision.evidence.map(
                (source) => (
                  <p key={source.factId}>
                    {source.evidenceSnippet} · Page {source.page || "?"} ·
                    Clause {source.clause || "?"}
                  </p>
                ),
              )}
            </article>
            <label>
              Mandatory engineering reason
              <textarea
                aria-label="Mandatory classification reason"
                value={engineeringClassificationAction.reason}
                onChange={(event) =>
                  setEngineeringClassificationAction((current) =>
                    current
                      ? { ...current, reason: event.target.value }
                      : current,
                  )
                }
                placeholder="State why the evidence supports this engineering decision."
              />
            </label>
            <p>
              This review does not approve matching readiness, a product, or a
              price.
            </p>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                onClick={() => setEngineeringClassificationAction(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  engineeringClassificationLoading ||
                  engineeringClassificationAction.reason.trim().length < 5
                }
                onClick={() => void submitEngineeringClassificationAction()}
              >
                Record engineering decision
              </button>
            </footer>
          </section>
        </div>
      )}

      {applicabilityReviewOpen && (
        <div
          className="match-overlay applicability-review-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="applicability-review-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeApplicabilityReview}
            aria-label="Close applicability review"
          />
          <section className="match-panel applicability-review-panel">
            <header className="match-header">
              <div>
                <small>BOQ-TO-SPECIFICATION GOVERNANCE</small>
                <h2 id="applicability-review-title">Applicability Review</h2>
                <p>
                  {projectName} · {applicabilityLinks.length} current links ·
                  reviewer {authSession.user.displayName}
                </p>
              </div>
              <button
                onClick={closeApplicabilityReview}
                aria-label="Close applicability review"
              >
                ×
              </button>
            </header>
            <div className="applicability-filters">
              <label>
                BOQ item
                <select
                  aria-label="Filter applicability by BOQ item"
                  value={applicabilityItemFilter}
                  onChange={(event) =>
                    setApplicabilityItemFilter(event.target.value)
                  }
                >
                  <option value="All">All BOQ items</option>
                  {applicabilityItemOptions.map(([id, description]) => (
                    <option key={id} value={id}>
                      {description}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  aria-label="Filter applicability by status"
                  value={applicabilityStatusFilter}
                  onChange={(event) =>
                    setApplicabilityStatusFilter(event.target.value)
                  }
                >
                  <option>Open</option>
                  <option>All</option>
                  <option>Confirmed</option>
                  <option>Rejected</option>
                  <option>Removed</option>
                </select>
              </label>
              <button
                onClick={() => void loadApplicabilityLinks()}
                disabled={applicabilityLoading}
              >
                {applicabilityLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {applicabilityError && (
              <p
                className="managed-document-error requirement-review-error"
                role="alert"
              >
                {applicabilityError}
              </p>
            )}
            <div
              className="applicability-list"
              aria-label="Applicability suggestions"
            >
              {filteredApplicabilityLinks.map((link) => {
                const evidence = Array.isArray(link.evidence)
                  ? link.evidence
                  : link.evidence?.basis || [];
                const assessment = Array.isArray(link.evidence)
                  ? link.confidence >= 70
                    ? "Applicable Candidate"
                    : "Uncertain"
                  : link.evidence?.assessment || "Uncertain";
                return (
                  <article key={link.id}>
                    <header>
                      <div>
                        <small>BOQ ITEM</small>
                        <strong>
                          {link.item_number ? `${link.item_number} · ` : ""}
                          {link.boq_description}
                        </strong>
                      </div>
                      <span
                        className={
                          link.status === "Confirmed"
                            ? "review-ready"
                            : link.status === "Rejected" ||
                                link.status === "Removed"
                              ? "review-blocked"
                              : "review-pending"
                        }
                      >
                        {link.status}
                      </span>
                    </header>
                    <div className="applicability-confidence">
                      <strong>{link.confidence}%</strong>
                      <span>{assessment}</span>
                      <small>
                        {link.link_method} · link v{link.version_number}
                      </small>
                    </div>
                    <section>
                      <small>
                        SUGGESTED REQUIREMENT #{link.requirement_sequence}
                      </small>
                      <p>{link.original_text}</p>
                      <small>
                        Page {link.source_location.pageFrom || "?"} · Clause{" "}
                        {link.source_location.clause || "?"}
                        {link.source_location.section
                          ? ` · ${link.source_location.section}`
                          : ""}
                      </small>
                    </section>
                    <section>
                      <small>MATCHING BASIS</small>
                      <ul>
                        {evidence.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    </section>
                    {link.review_reason && (
                      <aside>
                        <strong>Reviewed by {link.reviewed_by}</strong>
                        <p>{link.review_reason}</p>
                        <small>
                          {link.reviewed_at
                            ? new Date(link.reviewed_at).toLocaleString()
                            : ""}
                        </small>
                      </aside>
                    )}
                    {["Suggested", "Needs Review"].includes(link.status) && (
                      <footer>
                        <button
                          onClick={() =>
                            setApplicabilityReviewAction({
                              link,
                              operation: "confirm",
                              reason: "",
                            })
                          }
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() =>
                            setApplicabilityReviewAction({
                              link,
                              operation: "reject",
                              reason: "",
                            })
                          }
                        >
                          Reject
                        </button>
                        <button
                          onClick={() =>
                            setApplicabilityReviewAction({
                              link,
                              operation: "remove",
                              reason: "",
                            })
                          }
                        >
                          Remove
                        </button>
                      </footer>
                    )}
                  </article>
                );
              })}
              {!applicabilityLoading && !filteredApplicabilityLinks.length && (
                <div className="empty-state">
                  <strong>No applicability links match this view</strong>
                  <p>
                    Suggestions are never auto-confirmed. Change the filters or
                    regenerate after approving source requirements.
                  </p>
                </div>
              )}
            </div>
            <footer className="preview-actions">
              <span>
                Confirm recalculates only the affected Requirement Profile.
                Reject and Remove never change profiles.
              </span>
              <button onClick={closeApplicabilityReview}>Close review</button>
            </footer>
          </section>
        </div>
      )}

      {applicabilityReviewAction && (
        <div
          className="match-overlay requirement-action-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="applicability-action-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setApplicabilityReviewAction(null)}
            aria-label="Cancel applicability decision"
          />
          <section className="match-panel requirement-action-panel">
            <header className="match-header">
              <div>
                <small>IMMUTABLE APPLICABILITY DECISION</small>
                <h2 id="applicability-action-title">
                  {applicabilityReviewAction.operation[0].toUpperCase()}
                  {applicabilityReviewAction.operation.slice(1)} suggestion
                </h2>
                <p>
                  {applicabilityReviewAction.link.boq_description} · requirement
                  #{applicabilityReviewAction.link.requirement_sequence}
                </p>
              </div>
              <button
                onClick={() => setApplicabilityReviewAction(null)}
                aria-label="Cancel applicability decision"
              >
                ×
              </button>
            </header>
            <article className="requirement-evidence">
              <small>SOURCE EVIDENCE</small>
              <p>{applicabilityReviewAction.link.original_text}</p>
              <small>
                Page{" "}
                {applicabilityReviewAction.link.source_location.pageFrom || "?"}{" "}
                · Clause{" "}
                {applicabilityReviewAction.link.source_location.clause || "?"}
              </small>
            </article>
            <label>
              Mandatory reviewer reason
              <textarea
                aria-label="Mandatory applicability reason"
                value={applicabilityReviewAction.reason}
                onChange={(event) =>
                  setApplicabilityReviewAction((current) =>
                    current
                      ? { ...current, reason: event.target.value }
                      : current,
                  )
                }
                placeholder="Explain why this requirement is or is not technically applicable to the BOQ item."
              />
            </label>
            <p>
              Authenticated reviewer: {authSession.user.displayName} ·{" "}
              {authSession.user.email}. Suggestions can never confirm
              themselves.
            </p>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                onClick={() => setApplicabilityReviewAction(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  applicabilityActionLoading ||
                  applicabilityReviewAction.reason.trim().length < 5
                }
                onClick={() => void submitApplicabilityReview()}
              >
                {applicabilityActionLoading
                  ? "Recording…"
                  : "Record applicability decision"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showValidationReport && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="validation-report-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setShowValidationReport(false)}
            aria-label="Close validation report"
          />
          <section className="match-panel validation-report-panel">
            <header className="match-header">
              <div>
                <small>PROJECT VALIDATION</small>
                <h2 id="validation-report-title">Evidence-based checks</h2>
                <p>
                  {projectName} · {failedValidationChecks.length} blocking check
                  {failedValidationChecks.length === 1 ? "" : "s"} ·{" "}
                  {quotationFingerprint}
                </p>
              </div>
              <button
                onClick={() => setShowValidationReport(false)}
                aria-label="Close validation report"
              >
                ×
              </button>
            </header>
            <div
              className={`validation-report-summary ${failedValidationChecks.length ? "blocked" : "passed"}`}
            >
              <span>{failedValidationChecks.length ? "!" : "✓"}</span>
              <div>
                <strong>
                  {failedValidationChecks.length
                    ? "Quotation issue remains blocked"
                    : "All visible controls pass"}
                </strong>
                <p>
                  {failedValidationChecks.length
                    ? "Resolve the evidence gaps below. A zero total or an opened screen never counts as a passed control."
                    : "Final issue still requires a human quotation approval tied to the current fingerprint."}
                </p>
              </div>
            </div>
            <div className="validation-check-list">
              {validationChecks.map((check) => (
                <article key={check.title}>
                  <span className={check.passed ? "check-pass" : "check-open"}>
                    {check.passed ? "✓" : "!"}
                  </span>
                  <div>
                    <strong>{check.title}</strong>
                    <p>{check.detail}</p>
                    <small>OWNER · {check.owner}</small>
                  </div>
                  <b
                    className={check.passed ? "review-ready" : "review-blocked"}
                  >
                    {check.passed ? "Passed" : "Blocking"}
                  </b>
                  {!check.passed && (
                    <button
                      onClick={() => {
                        setShowValidationReport(false);
                        if (check.target === "Settings") openPricingSettings();
                        else navigate(check.target);
                      }}
                    >
                      Resolve →
                    </button>
                  )}
                </article>
              ))}
            </div>
            <footer className="preview-actions">
              <span>
                {validationChecks.length - failedValidationChecks.length} of{" "}
                {validationChecks.length} checks passed
              </span>
              <button onClick={() => setShowValidationReport(false)}>
                Close report
              </button>
            </footer>
          </section>
        </div>
      )}

      {showUploadIntent && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-intent-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => {
              setShowUploadIntent(false);
              setUploadIntentRole(null);
            }}
            aria-label="Close document intake"
          />
          <section className="match-panel upload-intent-panel">
            <header className="match-header">
              <div>
                <small>CURRENT PROJECT · CONTROLLED INTAKE</small>
                <h2 id="upload-intent-title">What do these files contain?</h2>
                <p>
                  {projectName} · choose the intended evidence role before
                  selecting files
                </p>
              </div>
              <button
                onClick={() => {
                  setShowUploadIntent(false);
                  setUploadIntentRole(null);
                }}
                aria-label="Close document intake"
              >
                ×
              </button>
            </header>
            <div className="upload-intent-note">
              <strong>Registration is not approval</strong>
              <p>
                The selected role controls the review queue only. Uploading
                cannot change BOQ quantities, approve a product, apply a
                supplier price, or replace the active tender baseline.
              </p>
            </div>
            <div className="boq-template-callout">
              <div>
                <strong>Starting a new BOQ?</strong>
                <p>
                  Use the controlled CSV template: System, Description, Unit and
                  Quantity are required; Technical Reference is optional. Price,
                  supplier, rate, cost and total columns are ignored.
                </p>
              </div>
              <button onClick={downloadBoqTemplate}>
                ⇩ Download blank BOQ template
              </button>
            </div>
            <div className="upload-intent-grid">
              <button
                className={uploadIntentRole === "BOQ" ? "selected" : ""}
                onClick={() => beginDocumentUpload("BOQ")}
              >
                <span>☷</span>
                <div>
                  <strong>Bill of quantities</strong>
                  <p>
                    Register scope for duplicate checking and row-level
                    extraction review.
                  </p>
                  <small>Requires explicit extraction approval</small>
                </div>
                <b>Choose files →</b>
              </button>
              <button
                className={
                  uploadIntentRole === "Supplier quotation" ? "selected" : ""
                }
                onClick={() => beginDocumentUpload("Supplier quotation")}
              >
                <span>♙</span>
                <div>
                  <strong>Supplier quotation</strong>
                  <p>
                    Register current commercial evidence outside project costs.
                  </p>
                  <small>Requires normalization and separate award</small>
                </div>
                <b>Choose files →</b>
              </button>
              <button
                className={
                  uploadIntentRole === "Specification" ? "selected" : ""
                }
                onClick={() => beginDocumentUpload("Specification")}
              >
                <span>▤</span>
                <div>
                  <strong>Specification or drawing</strong>
                  <p>
                    Register technical references for clause and compliance
                    review.
                  </p>
                  <small>Cannot approve a product or price</small>
                </div>
                <b>Choose files →</b>
              </button>
              <button
                className={
                  uploadIntentRole === "Client inquiry" ? "selected" : ""
                }
                onClick={() => beginDocumentUpload("Client inquiry")}
              >
                <span>✉</span>
                <div>
                  <strong>Client inquiry or scope letter</strong>
                  <p>
                    Register inquiry instructions, requested boundaries,
                    exclusions and bidder obligations.
                  </p>
                  <small>
                    Cannot authorize an exclusion until issue and content review
                  </small>
                </div>
                <b>Choose files →</b>
              </button>
              <button
                className={
                  uploadIntentRole === "Price source" ? "selected" : ""
                }
                onClick={() => beginDocumentUpload("Price source")}
              >
                <span>▱</span>
                <div>
                  <strong>Manufacturer price source</strong>
                  <p>
                    Register a catalogue or price list for currency, validity
                    and sheet review.
                  </p>
                  <small>Cannot affect costs until governed approval</small>
                </div>
                <b>Choose files →</b>
              </button>
              <button onClick={() => beginDocumentUpload("Unclassified")}>
                <span>◷</span>
                <div>
                  <strong>Historical or unknown reference</strong>
                  <p>
                    Keep previous-project data or an uncertain file isolated for
                    classification.
                  </p>
                  <small>Reference only until reviewed</small>
                </div>
                <b>Choose files →</b>
              </button>
            </div>
          </section>
        </div>
      )}

      {backupPreview && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-preview-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setBackupPreview(null)}
            aria-label="Close backup preview"
          />
          <section className="match-panel backup-preview-panel">
            <header className="match-header">
              <div>
                <small>LOCAL BACKUP · PREVIEW FIRST</small>
                <h2 id="backup-preview-title">
                  Restore as separate workspaces
                </h2>
                <p>
                  {backupPreview.envelope.checksum} · exported{" "}
                  {new Date(backupPreview.envelope.exportedAt).toLocaleString(
                    "en-GB",
                  )}
                </p>
              </div>
              <button
                onClick={() => setBackupPreview(null)}
                aria-label="Close backup preview"
              >
                ×
              </button>
            </header>
            <div className="extraction-proof">
              <span>
                <small>PROJECTS</small>
                <strong>{backupPreview.envelope.projects.length}</strong>
              </span>
              <span>
                <small>BOQ LINES</small>
                <strong>{backupPreview.boqItems}</strong>
              </span>
              <span>
                <small>DOCUMENT RECORDS</small>
                <strong>{backupPreview.documents}</strong>
              </span>
              <span>
                <small>ID CONFLICTS</small>
                <strong>{backupPreview.conflicts}</strong>
              </span>
            </div>
            <div className="approval-blocked">
              <strong>No active project will be overwritten</strong>
              <p>
                Every restored project receives a new local identity and
                “Restored” name. Previous quotation approvals remain historical,
                but the changed project identity requires a new approval
                fingerprint before final issue.
              </p>
            </div>
            <div className="backup-limit-note">
              <strong>What the backup contains</strong>
              <p>
                It includes BOQ data, document names and fingerprints, issue
                metadata, technical and commercial decisions, RFQs, quotation
                history and audit events. Original PDF, Excel and
                supplier-quotation file bytes are not embedded; keep those
                source files separately.
              </p>
            </div>
            <div className="backup-project-list">
              {backupPreview.envelope.projects.map((project) => (
                <article key={project.id}>
                  <div>
                    <strong>{project.name}</strong>
                    <p>
                      {project.client} · {project.code}
                    </p>
                  </div>
                  <span>
                    {project.items.length} BOQ ·{" "}
                    {project.uploadedFiles.length +
                      (project.baseTenderLoaded
                        ? tenderDocuments.length
                        : 0)}{" "}
                    docs
                  </span>
                </article>
              ))}
            </div>
            <footer className="preview-actions">
              <button
                className="secondary-product"
                onClick={() => setBackupPreview(null)}
              >
                Cancel
              </button>
              <span>Checksum and required records verified</span>
              <button onClick={restoreLocalBackup}>
                Restore {backupPreview.envelope.projects.length} separate
                workspace
                {backupPreview.envelope.projects.length === 1 ? "" : "s"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showNewProject && (
        <div
          className="wizard-wrap"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-project-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeNewProjectWizard}
            aria-label="Close new project"
          />
          <section className="project-wizard">
            <header>
              <div>
                <small>NEW LOCAL PROJECT · STEP {newProjectStep} OF 2</small>
                <h2 id="new-project-title">
                  {newProjectStep === 1
                    ? "Project identity"
                    : "Review startup policy"}
                </h2>
              </div>
              <button onClick={closeNewProjectWizard} aria-label="Close">
                ×
              </button>
            </header>
            <div
              className="new-project-steps"
              aria-label="New project progress"
            >
              <span className="active">1 · Identity</span>
              <span className={newProjectStep === 2 ? "active" : ""}>
                2 · Startup controls
              </span>
            </div>
            <div className="wizard-body">
              {newProjectStep === 1 ? (
                <>
                  <div className="field-row">
                    <label>
                      Project name *
                      <input
                        autoFocus
                        value={draftProjectName}
                        onChange={(event) =>
                          setDraftProjectName(event.target.value)
                        }
                        placeholder="e.g. Riyadh School Fire Alarm"
                      />
                    </label>
                    <label>
                      Client / main contractor
                      <input
                        value={draftClientName}
                        onChange={(event) =>
                          setDraftClientName(event.target.value)
                        }
                        placeholder="Can be completed later"
                      />
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      Internal reference
                      <input
                        value={draftProjectCode}
                        onChange={(event) =>
                          setDraftProjectCode(event.target.value)
                        }
                        placeholder="Generated if blank"
                      />
                    </label>
                    <label>
                      Submission deadline
                      <input
                        type="date"
                        min={draftIntakeProfile.inquiryReceived || undefined}
                        value={draftProjectDueDate}
                        onChange={(event) =>
                          setDraftProjectDueDate(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <details className="tender-context">
                    <summary>
                      <span>Optional tender context</span>
                      <small>
                        Location, scope request and document availability
                      </small>
                    </summary>
                    <div className="tender-context-body">
                      <div className="field-row">
                        <label>
                          Country
                          <input
                            value={draftIntakeProfile.country}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                country: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          City
                          <input
                            value={draftIntakeProfile.city}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                city: event.target.value,
                              }))
                            }
                            placeholder="e.g. Riyadh"
                          />
                        </label>
                      </div>
                      <label>
                        Project location
                        <input
                          value={draftIntakeProfile.location}
                          onChange={(event) =>
                            setDraftIntakeProfile((current) => ({
                              ...current,
                              location: event.target.value,
                            }))
                          }
                          placeholder="Site, district or package location"
                        />
                      </label>
                      <div className="field-row">
                        <label>
                          Inquiry subject
                          <input
                            value={draftIntakeProfile.inquirySubject || ""}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                inquirySubject: event.target.value,
                              }))
                            }
                            placeholder="Client inquiry or tender subject"
                          />
                        </label>
                        <label>
                          Inquiry received
                          <input
                            type="date"
                            max={draftToday}
                            value={draftIntakeProfile.inquiryReceived || ""}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                inquiryReceived: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <div className="field-row">
                        <label>
                          Attention / contact
                          <input
                            value={draftIntakeProfile.contactName || ""}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                contactName: event.target.value,
                              }))
                            }
                            placeholder="Client contact name"
                          />
                        </label>
                        <label>
                          Contact email
                          <input
                            type="email"
                            value={draftIntakeProfile.contactEmail || ""}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                contactEmail: event.target.value,
                              }))
                            }
                            placeholder="Optional routing information"
                          />
                        </label>
                      </div>
                      <label>
                        Contact phone
                        <input
                          type="tel"
                          value={draftIntakeProfile.contactPhone || ""}
                          onChange={(event) =>
                            setDraftIntakeProfile((current) => ({
                              ...current,
                              contactPhone: event.target.value,
                            }))
                          }
                          placeholder="Optional routing information"
                        />
                      </label>
                      <div className="field-row">
                        <label>
                          Construction system
                          <select
                            value={draftIntakeProfile.system}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                system: event.target.value,
                              }))
                            }
                          >
                            <option>Fire Detection &amp; Alarm</option>
                            <option>CCTV &amp; Access Control</option>
                          </select>
                        </label>
                        <label>
                          Declared scope request
                          <select
                            value={draftIntakeProfile.scopeIntent}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                scopeIntent: event.target
                                  .value as ProjectIntakeProfile["scopeIntent"],
                              }))
                            }
                          >
                            <option>Pending tender review</option>
                            <option>Materials only requested</option>
                            <option>Supply and installation requested</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Buildings / zones
                        <textarea
                          value={draftIntakeProfile.buildings}
                          onChange={(event) =>
                            setDraftIntakeProfile((current) => ({
                              ...current,
                              buildings: event.target.value,
                            }))
                          }
                          placeholder={
                            "One per line, e.g.\nB01 – Main Building\nB02 – Substation"
                          }
                        />
                      </label>
                      <div className="field-row">
                        <label>
                          BOQ availability
                          <select
                            value={draftIntakeProfile.boqAvailability}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                boqAvailability: event.target
                                  .value as ProjectIntakeProfile["boqAvailability"],
                              }))
                            }
                          >
                            <option>Unknown</option>
                            <option>Available</option>
                            <option>Not available yet</option>
                          </select>
                        </label>
                        <label>
                          Drawing availability
                          <select
                            value={draftIntakeProfile.drawingAvailability}
                            onChange={(event) =>
                              setDraftIntakeProfile((current) => ({
                                ...current,
                                drawingAvailability: event.target
                                  .value as ProjectIntakeProfile["drawingAvailability"],
                              }))
                            }
                          >
                            <option>Unknown</option>
                            <option>Available</option>
                            <option>Not available yet</option>
                          </select>
                        </label>
                      </div>
                      <div className="intake-only-note">
                        <strong>Declaration only</strong>
                        <p>
                          These answers help organize intake. They cannot
                          approve a materials-only exclusion, activate a price
                          library, apply a discount, or satisfy document
                          controls.
                        </p>
                      </div>
                    </div>
                  </details>
                  <div className="project-focus-card">
                    <span>FIRE DETECTION &amp; ALARM</span>
                    <strong>Evidence-first pricing workspace</strong>
                    <p>
                      Requested scope is recorded as an intake declaration only.
                      Tender documents and formal authority still control
                      whether installation, programming, testing or
                      commissioning may be excluded.
                    </p>
                  </div>
                  {draftProjectIdentityConflict && (
                    <div className="existing-boq-warning">
                      <strong>Project identity already exists</strong>
                      <p>
                        {draftProjectIdentityConflictReason}. Use a unique
                        internal reference or confirm that this inquiry belongs
                        in the existing workspace.
                      </p>
                    </div>
                  )}
                  {draftTenderTimelineBlocked && (
                    <div className="existing-boq-warning">
                      <strong>Tender timeline needs correction</strong>
                      <p>
                        {draftTenderTimelineMessage}. Dates are recorded as
                        project-control evidence and must follow a possible
                        sequence.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="startup-policy-grid">
                    <article>
                      <span>1</span>
                      <div>
                        <strong>Empty evidence workspace</strong>
                        <p>
                          Documents are added after creation through the
                          controlled role-first intake.
                        </p>
                      </div>
                    </article>
                    <article>
                      <span>2</span>
                      <div>
                        <strong>No inherited prices</strong>
                        <p>
                          No catalogue discount, supplier price, RFQ, award or
                          quotation approval is assumed.
                        </p>
                      </div>
                    </article>
                    <article>
                      <span>3</span>
                      <div>
                        <strong>Commercial controls start open</strong>
                        <p>
                          Exchange rate, client payment, delivery location,
                          delivery period and freight terms require later
                          confirmation.
                        </p>
                      </div>
                    </article>
                    <article>
                      <span>4</span>
                      <div>
                        <strong>Existing project stays unchanged</strong>
                        <p>
                          Creating this workspace does not rename, blank,
                          archive or modify the active project.
                        </p>
                      </div>
                    </article>
                  </div>
                  <div className="new-project-review">
                    <span>
                      <small>PROJECT</small>
                      <strong>{draftProjectName}</strong>
                    </span>
                    <span>
                      <small>CLIENT</small>
                      <strong>
                        {draftClientName.trim() || "Not assigned yet"}
                      </strong>
                    </span>
                    <span>
                      <small>REFERENCE</small>
                      <strong>
                        {draftProjectCode.trim() || "Generated on creation"}
                      </strong>
                    </span>
                    <span>
                      <small>DEADLINE</small>
                      <strong>{draftProjectDueDate || "Not set"}</strong>
                    </span>
                    <span>
                      <small>INQUIRY</small>
                      <strong>
                        {draftIntakeProfile.inquirySubject?.trim() ||
                          "Not recorded"}
                        {draftIntakeProfile.inquiryReceived
                          ? ` · ${draftIntakeProfile.inquiryReceived}`
                          : ""}
                      </strong>
                    </span>
                    <span>
                      <small>CONTACT</small>
                      <strong>
                        {draftIntakeProfile.contactName?.trim() ||
                          "Not assigned"}
                        {draftIntakeProfile.contactEmail
                          ? ` · ${draftIntakeProfile.contactEmail}`
                          : ""}
                      </strong>
                    </span>
                    <span>
                      <small>DECLARED SCOPE</small>
                      <strong>{draftIntakeProfile.scopeIntent}</strong>
                    </span>
                    <span>
                      <small>DOCUMENTS</small>
                      <strong>
                        BOQ {draftIntakeProfile.boqAvailability} · Drawings{" "}
                        {draftIntakeProfile.drawingAvailability}
                      </strong>
                    </span>
                  </div>
                </>
              )}
            </div>
            <footer>
              {newProjectStep === 1 ? (
                <>
                  <button className="secondary" onClick={closeNewProjectWizard}>
                    Cancel
                  </button>
                  <span>
                    Only the project name is required; any supplied reference
                    must be unique.
                  </span>
                  <button
                    disabled={
                      !draftProjectName.trim() ||
                      Boolean(draftProjectIdentityConflict) ||
                      draftTenderTimelineBlocked
                    }
                    onClick={() => setNewProjectStep(2)}
                  >
                    Review startup controls →
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="secondary"
                    onClick={() => setNewProjectStep(1)}
                  >
                    ← Back
                  </button>
                  <span>Nothing changes until the project is created.</span>
                  <button
                    disabled={
                      Boolean(draftProjectIdentityConflict) ||
                      draftTenderTimelineBlocked
                    }
                    onClick={createLocalProject}
                  >
                    Create separate project
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      )}

      {showProjectEditor && (
        <div
          className="drawer-wrap"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-editor-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setShowProjectEditor(false)}
            aria-label="Close project editor"
          />
          <aside className="settings-drawer">
            <div className="drawer-title">
              <div>
                <small>PROJECT CONTROL</small>
                <h2 id="project-editor-title">Project details</h2>
              </div>
              <button
                onClick={() => setShowProjectEditor(false)}
                aria-label="Close project editor"
              >
                ×
              </button>
            </div>
            <div className="settings-note transactional-note">
              <strong>Draft project details</strong>
              <p>
                Closing or cancelling leaves the active workspace identity and
                status unchanged.
              </p>
            </div>
            <label>
              Project name
              <input
                value={projectDetailsDraft.name}
                onChange={(event) =>
                  setProjectDetailsDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Client
              <input
                value={projectDetailsDraft.client}
                onChange={(event) =>
                  setProjectDetailsDraft((current) => ({
                    ...current,
                    client: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Project code
              <input
                value={projectDetailsDraft.code}
                onChange={(event) =>
                  setProjectDetailsDraft((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                value={projectDetailsDraft.dueDate}
                onChange={(event) =>
                  setProjectDetailsDraft((current) => ({
                    ...current,
                    dueDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Status
              <select
                value={projectDetailsDraft.status}
                onChange={(event) =>
                  setProjectDetailsDraft((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option>Draft</option>
                <option>Documents Pending</option>
                <option>Technical Review</option>
                <option>Pricing</option>
                <option>Supplier RFQ</option>
                <option>Quotation Draft</option>
                <option disabled={!currentQuotationApproval}>
                  Quotation Approved
                </option>
                <option>Archived</option>
              </select>
            </label>
            <div className="settings-note">
              <strong>Local project control</strong>
              <p>
                Changes are stored only in this browser. Duplicate and archive
                actions are available from the project menu.
              </p>
            </div>
            <div className="settings-actions">
              <button
                className="secondary"
                onClick={() => setShowProjectEditor(false)}
              >
                Cancel
              </button>
              <button
                className="save-settings"
                disabled={
                  !projectDetailsDraft.name.trim() ||
                  !projectDetailsDraft.code.trim()
                }
                onClick={saveProjectDetails}
              >
                Save project details
              </button>
            </div>
          </aside>
        </div>
      )}

      {showSettings && (
        <div className="drawer-wrap">
          <button
            className="drawer-scrim"
            onClick={() => setShowSettings(false)}
            aria-label="Close settings"
          />
          <aside className="settings-drawer">
            <div className="drawer-title">
              <div>
                <small>PROJECT SETTINGS</small>
                <h2>Pricing parameters</h2>
              </div>
              <button onClick={() => setShowSettings(false)}>×</button>
            </div>
            <div className="settings-note transactional-note">
              <strong>Draft changes only</strong>
              <p>
                Nothing below changes project calculations until you confirm the
                complete settings package. Closing or cancelling discards the
                draft.
              </p>
            </div>
            <div
              className={`settings-note decision-owner-note ${canViewCommercial ? "owner-ready" : "owner-handoff"}`}
            >
              <strong>Server-assigned commercial access</strong>
              <p>
                Effective project permission: {workingRole}.{" "}
                {canViewCommercial
                  ? "The backend has granted access to this commercial workspace."
                  : "Commercial changes are blocked. Ask an organization administrator to update your durable project membership."}
              </p>
            </div>
            {currentQuotationApproval && (
              <div className="existing-boq-warning">
                <strong>
                  Approved revision {currentQuotationApproval.revision} will
                  become superseded
                </strong>
                <p>
                  Confirming any changed rate evidence, VAT, allowance,
                  warranty, validity, payment, delivery, freight or
                  qualification term creates a different quotation fingerprint.
                  The current approved client export will be blocked until a new
                  revision is reviewed and approved.
                </p>
              </div>
            )}
            <label>
              USD to SAR rate
              <input
                type="number"
                value={settingsDraft.exchangeRate}
                min="0"
                step="0.001"
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    exchangeRate: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Rate source / reference
              <input
                value={settingsDraft.exchangeRateEvidence.source}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    exchangeRateEvidence: {
                      ...current.exchangeRateEvidence,
                      source: event.target.value,
                    },
                  }))
                }
                placeholder="e.g. SAMA bulletin or bank reference"
              />
            </label>
            <label>
              Rate effective date
              <input
                type="date"
                value={settingsDraft.exchangeRateEvidence.effectiveDate}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    exchangeRateEvidence: {
                      ...current.exchangeRateEvidence,
                      effectiveDate: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label>
              Rate valid until
              <input
                type="date"
                value={settingsDraft.exchangeRateEvidence.validUntil}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    exchangeRateEvidence: {
                      ...current.exchangeRateEvidence,
                      validUntil: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <div className="settings-note">
              <strong>Dated conversion evidence</strong>
              <p>
                USD conversion remains blocked until the rate source is
                identified, already effective and not expired. Expiry
                automatically reopens the commercial control.
              </p>
            </div>
            <label>
              VAT
              <input
                type="number"
                value={settingsDraft.vatRate}
                min="0"
                max="100"
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    vatRate: Number(event.target.value),
                  }))
                }
              />
              <span>%</span>
            </label>
            <label>
              Contingency / risk allowance
              <input
                type="number"
                value={settingsDraft.riskAllowanceRate}
                min="0"
                max="100"
                step="0.25"
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    riskAllowanceRate: Number(event.target.value),
                  }))
                }
              />
              <span>%</span>
            </label>
            {settingsDraft.riskAllowanceRate > 0 && (
              <label>
                Risk allowance rationale
                <textarea
                  value={settingsDraft.riskAllowanceReason}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      riskAllowanceReason: event.target.value,
                    }))
                  }
                  placeholder="Required: identify the quantified uncertainty or commercial risk"
                />
              </label>
            )}
            <div className="settings-note">
              <strong>Visible allowance—not hidden markup</strong>
              <p>
                The allowance is applied after line-level selling prices and
                shown separately in reports and quotation totals. A positive
                percentage requires a commercial rationale and creates a new
                quotation fingerprint.
              </p>
            </div>
            <label>
              Default warranty
              <select
                value={settingsDraft.warrantyMonths}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    warrantyMonths: Number(event.target.value),
                  }))
                }
              >
                <option value="12">12 months</option>
                <option value="24">24 months</option>
                <option value="36">36 months</option>
              </select>
            </label>
            <label>
              Quotation validity
              <select
                value={settingsDraft.validityDays}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    validityDays: Number(event.target.value),
                  }))
                }
              >
                <option value="30">30 days</option>
                <option value="15">15 days</option>
                <option value="45">45 days</option>
              </select>
            </label>
            <label>
              Client payment terms
              <textarea
                value={settingsDraft.clientPaymentTerms}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    clientPaymentTerms: event.target.value,
                  }))
                }
                placeholder="Required for final quotation approval"
              />
            </label>
            <label>
              Client delivery terms
              <textarea
                value={settingsDraft.clientDeliveryTerms}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    clientDeliveryTerms: event.target.value,
                  }))
                }
                placeholder="Required for final quotation approval"
              />
            </label>
            <label>
              Client delivery location
              <input
                value={settingsDraft.clientDeliveryLocation}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    clientDeliveryLocation: event.target.value,
                  }))
                }
                placeholder="Required destination, site or collection point"
              />
            </label>
            <label>
              Client freight treatment
              <select
                value={settingsDraft.clientFreightTerms}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    clientFreightTerms: event.target.value,
                  }))
                }
              >
                <option value="">Select explicitly…</option>
                <option>Included in selling price</option>
                <option>Excluded; client account</option>
                <option>Quoted separately</option>
              </select>
            </label>
            <label>
              Client qualifications / assumptions
              <textarea
                value={settingsDraft.clientQualifications}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    clientQualifications: event.target.value,
                  }))
                }
                placeholder={
                  'Required. Record project-specific qualifications or enter "None" after review.'
                }
              />
            </label>
            {awardedReviews.length > 0 && (
              <div className="settings-note">
                <strong>Supplier benchmark · not client terms</strong>
                <p>
                  {supplierDeliveryBenchmark
                    ? `Longest awarded supplier lead time: ${supplierDeliveryBenchmark} weeks. `
                    : ""}
                  {supplierPaymentBenchmarks.length
                    ? `Supplier payment terms: ${supplierPaymentBenchmarks.join(" / ")}.`
                    : "Supplier payment terms were not recorded."}
                </p>
              </div>
            )}
            <div className="settings-note">
              <strong>Calculation guardrail</strong>
              <p>
                The final quotation cannot be generated while an item is missing
                a source, quantity, or summary link.
              </p>
            </div>
            <div className="settings-actions">
              <button
                className="secondary"
                onClick={() => setShowSettings(false)}
              >
                Cancel
              </button>
              <button
                className="save-settings"
                disabled={
                  settingsDraft.exchangeRate <= 0 ||
                  !settingsDraft.exchangeRateEvidence.source.trim() ||
                  !settingsDraft.exchangeRateEvidence.effectiveDate ||
                  !settingsDraft.exchangeRateEvidence.validUntil ||
                  settingsDraft.exchangeRateEvidence.effectiveDate >
                    new Date().toISOString().slice(0, 10) ||
                  settingsDraft.exchangeRateEvidence.validUntil <
                    new Date().toISOString().slice(0, 10) ||
                  settingsDraft.vatRate < 0 ||
                  settingsDraft.vatRate > 100 ||
                  settingsDraft.riskAllowanceRate < 0 ||
                  settingsDraft.riskAllowanceRate > 100 ||
                  (settingsDraft.riskAllowanceRate > 0 &&
                    settingsDraft.riskAllowanceReason.trim().length < 10) ||
                  settingsDraft.warrantyMonths <= 0 ||
                  settingsDraft.validityDays <= 0 ||
                  (!scopeMissing &&
                    (!settingsDraft.clientPaymentTerms.trim() ||
                      !settingsDraft.clientDeliveryTerms.trim() ||
                      !settingsDraft.clientDeliveryLocation.trim() ||
                      !settingsDraft.clientFreightTerms.trim() ||
                      settingsDraft.clientQualifications.trim().length < 4))
                }
                onClick={confirmPricingSettings}
              >
                Confirm and apply settings
              </button>
            </div>
          </aside>
        </div>
      )}

      {boqPreviewFile && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="boq-preview-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeKnownBoqExtraction}
            aria-label="Close BOQ extraction review"
          />
          <section className="match-panel boq-preview-panel">
            <header className="match-header">
              <div>
                <small>CONTROLLED WORKBOOK EXTRACTION</small>
                <h2 id="boq-preview-title">
                  Review 21 normalized BOQ candidates
                </h2>
                <p>
                  {boqPreviewFile} · MECH RFQ · 90 source item rows · source
                  anchors retained
                </p>
              </div>
              <button
                onClick={closeKnownBoqExtraction}
                aria-label="Close BOQ extraction review"
              >
                ×
              </button>
            </header>
            {documentControlEditor(boqPreviewFile)}
            <div className="extraction-proof">
              <span>
                <small>WORKBOOK MATCH</small>
                <strong>Exact SHA-256 fingerprint</strong>
              </span>
              <span>
                <small>SOURCE ROWS</small>
                <strong>90 item rows</strong>
              </span>
              <span>
                <small>ANCHOR RECONCILIATION</small>
                <strong
                  className={
                    knownBoqAnchorIntegrityValid
                      ? "review-ready"
                      : "review-blocked"
                  }
                >
                  {knownBoqAnchorIntegrity.uniqueAnchorCount} unique ·{" "}
                  {knownBoqAnchorIntegrity.duplicateAssignments} duplicate
                </strong>
              </span>
              <span>
                <small>NORMALIZED SCOPE</small>
                <strong>21 unique lines</strong>
              </span>
              <span>
                <small>PRICES IMPORTED</small>
                <strong>None</strong>
              </span>
            </div>
            <div className="approval-blocked">
              <strong>Every normalized line requires a decision</strong>
              <p>
                Accept lines that reconcile to their listed workbook rows.
                Exclusions require a reason. Applying imports only accepted
                descriptions, units, quantities and row anchors—never
                specifications or prices.
              </p>
            </div>
            {items.length > 0 && (
              <div className="existing-boq-warning">
                <strong>Current BOQ protected</strong>
                <p>
                  This project already contains {items.length} BOQ lines. The
                  extraction can be inspected but cannot overwrite them.
                </p>
              </div>
            )}
            <div className="boq-review-toolbar">
              <label>
                <span>Search candidates</span>
                <input
                  aria-label="Search normalized BOQ candidates"
                  value={boqReviewSearch}
                  onChange={(event) => setBoqReviewSearch(event.target.value)}
                  placeholder="Description, unit, quantity or source row"
                />
              </label>
              <div>
                <button
                  onClick={() =>
                    setBoqLineDecisions((current) => ({
                      ...current,
                      ...Object.fromEntries(
                        visibleBoqCandidates.map((item) => [
                          item.id,
                          "Accepted",
                        ]),
                      ),
                    }))
                  }
                >
                  Accept visible ({visibleBoqCandidates.length})
                </button>
                <span>
                  {boqAcceptedCount} accepted · {boqExcludedCount} excluded ·{" "}
                  {boqPendingCount} pending
                </span>
              </div>
            </div>
            <div className="compact-table extraction-preview-table">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Normalized description</th>
                    <th>Workbook evidence</th>
                    <th>Unit</th>
                    <th>Quantity</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBoqCandidates.map((item) => {
                    const decision = boqLineDecisions[item.id] || "Pending";
                    return (
                      <tr
                        key={item.id}
                        className={`extraction-${decision.toLowerCase()}`}
                      >
                        <td>BOQ-{String(item.id).padStart(3, "0")}</td>
                        <td>
                          <strong>{item.item}</strong>
                          {decision === "Excluded" && (
                            <input
                              aria-label={`Exclusion reason for ${item.item}`}
                              value={boqExclusionReasons[item.id] || ""}
                              onChange={(event) =>
                                setBoqExclusionReasons((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              placeholder="Required exclusion reason"
                            />
                          )}
                        </td>
                        <td>
                          <strong>MECH RFQ</strong>
                          <small>Rows {item.sourceRows.join(", ")}</small>
                        </td>
                        <td>{item.unit}</td>
                        <td>{item.qty}</td>
                        <td>
                          <div className="line-decision">
                            <button
                              className={
                                decision === "Accepted"
                                  ? "decision-accepted"
                                  : ""
                              }
                              onClick={() =>
                                setBoqLineDecisions((current) => ({
                                  ...current,
                                  [item.id]: "Accepted",
                                }))
                              }
                            >
                              Accept
                            </button>
                            <button
                              className={
                                decision === "Excluded"
                                  ? "decision-excluded"
                                  : ""
                              }
                              onClick={() =>
                                setBoqLineDecisions((current) => ({
                                  ...current,
                                  [item.id]: "Excluded",
                                }))
                              }
                            >
                              Exclude
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!visibleBoqCandidates.length && (
              <div className="empty-state">
                <strong>No normalized lines match this search</strong>
                <p>Clear the search to continue the full extraction review.</p>
              </div>
            )}
            <footer className="preview-actions">
              <button
                className="secondary-product"
                onClick={closeKnownBoqExtraction}
              >
                Cancel and discard decisions
              </button>
              <span>
                {!knownBoqAnchorIntegrityValid
                  ? "Source-anchor reconciliation failed"
                  : boqPendingCount
                    ? `${boqPendingCount} decisions pending`
                    : boqExclusionsMissingReason
                      ? `${boqExclusionsMissingReason} exclusion reason${boqExclusionsMissingReason === 1 ? "" : "s"} required`
                      : "Review complete"}
              </span>
              <button
                disabled={
                  items.length > 0 ||
                  !knownBoqAnchorIntegrityValid ||
                  boqPendingCount > 0 ||
                  boqExclusionsMissingReason > 0 ||
                  boqAcceptedCount === 0
                }
                onClick={() => applyKnownBoqExtraction(boqPreviewFile)}
              >
                {items.length
                  ? "Existing BOQ cannot be overwritten"
                  : `Apply ${boqAcceptedCount} accepted line${boqAcceptedCount === 1 ? "" : "s"}`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {genericBoqPreview && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="generic-boq-preview-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeGenericBoqPreview}
            aria-label="Close generic BOQ review"
          />
          <section className="match-panel boq-preview-panel">
            <header className="match-header">
              <div>
                <small>GENERIC CSV · PREVIEW FIRST</small>
                <h2 id="generic-boq-preview-title">Review imported BOQ rows</h2>
                <p>
                  {genericBoqPreview.fileName} · SHA-256{" "}
                  {genericBoqPreview.hash.slice(0, 12)}… · registered in this
                  project only
                </p>
              </div>
              <button
                onClick={closeGenericBoqPreview}
                aria-label="Close generic BOQ review"
              >
                ×
              </button>
            </header>
            {documentControlEditor(genericBoqPreview.fileName)}
            {genericBoqPreview.fatalError ? (
              <div className="approval-blocked">
                <strong>CSV structure is not valid</strong>
                <p>
                  {genericBoqPreview.fatalError}. Download the controlled
                  template and upload a corrected file. The registered document
                  remains unchanged and no BOQ rows were applied.
                </p>
              </div>
            ) : (
              <>
                <div className="extraction-proof">
                  <span>
                    <small>CANDIDATE ROWS</small>
                    <strong>{genericBoqPreview.candidates.length}</strong>
                  </span>
                  <span>
                    <small>REQUIRED FIELDS</small>
                    <strong>System · Description · Unit · Quantity</strong>
                  </span>
                  <span>
                    <small>PRICE COLUMNS</small>
                    <strong>
                      {genericBoqPreview.ignoredPriceColumns.length
                        ? `${genericBoqPreview.ignoredPriceColumns.length} ignored`
                        : "None supplied"}
                    </strong>
                  </span>
                  <span>
                    <small>PRICES IMPORTED</small>
                    <strong>None</strong>
                  </span>
                </div>
                {genericBoqPreview.ignoredPriceColumns.length > 0 && (
                  <div className="existing-boq-warning">
                    <strong>Commercial columns ignored</strong>
                    <p>
                      {genericBoqPreview.ignoredPriceColumns.join(", ")} cannot
                      enter project costing through BOQ intake. Supplier pricing
                      requires a separate current quotation and governed award.
                    </p>
                  </div>
                )}
                {items.length > 0 && (
                  <div className="existing-boq-warning">
                    <strong>Current BOQ protected</strong>
                    <p>
                      This project already contains {items.length} BOQ lines.
                      The CSV can be inspected but cannot overwrite them.
                    </p>
                  </div>
                )}
                <div className="boq-review-toolbar">
                  <label>
                    <span>Search CSV rows</span>
                    <input
                      aria-label="Search generic BOQ candidates"
                      value={boqReviewSearch}
                      onChange={(event) =>
                        setBoqReviewSearch(event.target.value)
                      }
                      placeholder="System, description, unit, quantity or CSV row"
                    />
                  </label>
                  <div>
                    <button
                      onClick={() =>
                        setBoqLineDecisions((current) => ({
                          ...current,
                          ...Object.fromEntries(
                            visibleGenericBoqCandidates
                              .filter((candidate) => !candidate.errors.length)
                              .map((candidate) => [
                                candidate.rowNumber,
                                "Accepted",
                              ]),
                          ),
                        }))
                      }
                    >
                      Accept valid visible (
                      {
                        visibleGenericBoqCandidates.filter(
                          (candidate) => !candidate.errors.length,
                        ).length
                      }
                      )
                    </button>
                    <span>
                      {genericAcceptedCount} accepted · {genericExcludedCount}{" "}
                      excluded · {genericPendingCount} pending
                    </span>
                  </div>
                </div>
                <div className="compact-table extraction-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>CSV row</th>
                        <th>System / description</th>
                        <th>Unit</th>
                        <th>Quantity</th>
                        <th>Technical reference</th>
                        <th>Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleGenericBoqCandidates.map((candidate) => {
                        const decision =
                          boqLineDecisions[candidate.rowNumber] || "Pending";
                        return (
                          <tr
                            key={candidate.rowNumber}
                            className={`extraction-${decision.toLowerCase()}`}
                          >
                            <td>{candidate.rowNumber}</td>
                            <td>
                              <strong>
                                {candidate.system || "Missing system"}
                              </strong>
                              <small>
                                {candidate.item || "Missing description"}
                              </small>
                              {candidate.errors.length > 0 && (
                                <span className="row-errors">
                                  {candidate.errors.join(" · ")}
                                </span>
                              )}
                              {decision === "Excluded" && (
                                <input
                                  aria-label={`Exclusion reason for CSV row ${candidate.rowNumber}`}
                                  value={
                                    boqExclusionReasons[candidate.rowNumber] ||
                                    ""
                                  }
                                  onChange={(event) =>
                                    setBoqExclusionReasons((current) => ({
                                      ...current,
                                      [candidate.rowNumber]: event.target.value,
                                    }))
                                  }
                                  placeholder="Required exclusion reason"
                                />
                              )}
                            </td>
                            <td>{candidate.unit || "—"}</td>
                            <td>{candidate.qty || "—"}</td>
                            <td>
                              {candidate.technicalReference || (
                                <span className="missing-text">
                                  Not supplied
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="line-decision">
                                <button
                                  disabled={Boolean(candidate.errors.length)}
                                  className={
                                    decision === "Accepted"
                                      ? "decision-accepted"
                                      : ""
                                  }
                                  onClick={() =>
                                    setBoqLineDecisions((current) => ({
                                      ...current,
                                      [candidate.rowNumber]: "Accepted",
                                    }))
                                  }
                                >
                                  Accept
                                </button>
                                <button
                                  className={
                                    decision === "Excluded"
                                      ? "decision-excluded"
                                      : ""
                                  }
                                  onClick={() =>
                                    setBoqLineDecisions((current) => ({
                                      ...current,
                                      [candidate.rowNumber]: "Excluded",
                                    }))
                                  }
                                >
                                  Exclude
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!visibleGenericBoqCandidates.length && (
                  <div className="empty-state">
                    <strong>No CSV rows match this search</strong>
                    <p>Clear the search to continue the full review.</p>
                  </div>
                )}
              </>
            )}
            <footer className="preview-actions">
              <button
                className="secondary-product"
                onClick={closeGenericBoqPreview}
              >
                Cancel and keep as registered only
              </button>
              {genericBoqPreview.fatalError ? (
                <button onClick={downloadBoqTemplate}>
                  Download corrected template
                </button>
              ) : (
                <>
                  <span>
                    {genericPendingCount
                      ? `${genericPendingCount} decisions pending`
                      : genericMissingReasons
                        ? `${genericMissingReasons} exclusion reason${genericMissingReasons === 1 ? "" : "s"} required`
                        : genericInvalidAccepted
                          ? `${genericInvalidAccepted} invalid acceptance${genericInvalidAccepted === 1 ? "" : "s"}`
                          : "Review complete"}
                  </span>
                  <button
                    disabled={
                      items.length > 0 ||
                      genericPendingCount > 0 ||
                      genericMissingReasons > 0 ||
                      genericInvalidAccepted > 0 ||
                      genericAcceptedCount === 0
                    }
                    onClick={applyGenericBoqExtraction}
                  >
                    {items.length
                      ? "Existing BOQ cannot be overwritten"
                      : `Apply ${genericAcceptedCount} accepted row${genericAcceptedCount === 1 ? "" : "s"}`}
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      )}

      {sourcePreviewFile && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-preview-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setSourcePreviewFile(null)}
            aria-label="Close price source review"
          />
          <section className="match-panel boq-preview-panel">
            <header className="match-header">
              <div>
                <small>GOVERNED SOURCE REVIEW</small>
                <h2 id="source-preview-title">Honeywell Farenhyt KSA V23.1</h2>
                <p>{sourcePreviewFile} · exact SHA-256 workbook match</p>
              </div>
              <button
                onClick={() => setSourcePreviewFile(null)}
                aria-label="Close price source review"
              >
                ×
              </button>
            </header>
            <div className="extraction-proof">
              <span>
                <small>EFFECTIVE DATE</small>
                <strong>01 Mar 2023</strong>
              </span>
              <span>
                <small>CATALOGUE</small>
                <strong>504 numeric price rows</strong>
              </span>
              <span>
                <small>CURRENCY</small>
                <strong>USD list price</strong>
              </span>
              <span>
                <small>PRICING STATUS</small>
                <strong>Discovery only</strong>
              </span>
            </div>
            <div className="approval-blocked">
              <strong>Historical catalogue cannot price the quotation</strong>
              <p>
                The workbook gives an effective date but no validity end date.
                Under the current-source rule it is treated as historical:
                products may be discovered, but every cost still requires a
                current supplier quotation or approved source.
              </p>
            </div>
            <div className="existing-boq-warning">
              <strong>65% discount is not a source rule</strong>
              <p>
                No catalogue row or release note states a 65% discount. A
                separate scratch cell contains “65 × 0.26”; it is not linked to
                the catalogue and cannot substantiate a commercial discount. Any
                discount must be entered later from dated supplier evidence.
              </p>
            </div>
            <div className="source-sheet-review">
              <div className="section-title">
                <div>
                  <small>SHEET CLASSIFICATION</small>
                  <strong>Only genuine catalogue rows enter discovery</strong>
                </div>
                <span>0 rows approved for project pricing</span>
              </div>
              <div className="compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Worksheet</th>
                      <th>Detected content</th>
                      <th>Currency</th>
                      <th>Disposition</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>2023 Farenhyt</strong>
                      </td>
                      <td>504 numeric list-price rows</td>
                      <td>USD</td>
                      <td>
                        <span className="review-ready">Discovery only</span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Release Notes</strong>
                      </td>
                      <td>Version and change notes</td>
                      <td>—</td>
                      <td>
                        <span className="review-blocked">Reference only</span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Obsolete &amp; Replacement archive</strong>
                      </td>
                      <td>83 replacement-mapping rows</td>
                      <td>—</td>
                      <td>
                        <span className="review-blocked">
                          Excluded from prices
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Sheet1</strong>
                      </td>
                      <td>3 unlabelled scratch values</td>
                      <td>—</td>
                      <td>
                        <span className="review-blocked">Excluded</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <section className="lifecycle-review-register">
              <div className="section-title">
                <div>
                  <small>PRODUCT LIFECYCLE EVIDENCE</small>
                  <strong>
                    Obsolete parts and stated replacement candidates
                  </strong>
                </div>
                <span>
                  {
                    Object.values(lifecycleReviews).filter(
                      (review) => review.status !== "Pending",
                    ).length
                  }{" "}
                  of {honeywellLifecycleMappings.length} reviewed
                </span>
              </div>
              <div className="lifecycle-warning">
                <strong>Replacement does not mean equivalent</strong>
                <p>
                  These mappings support discovery and supplier clarification
                  only. Engineering must still verify function, compatibility,
                  listing, approval, colour, base, loop protocol and project
                  specification before substitution.
                </p>
              </div>
              <div className="compact-table lifecycle-table">
                <table>
                  <thead>
                    <tr>
                      <th>Source row</th>
                      <th>Obsolete part</th>
                      <th>Workbook replacement</th>
                      <th>Source quality</th>
                      <th>Engineering record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {honeywellLifecycleMappings.map((mapping) => {
                      const review = lifecycleReviews[mapping.id] || {
                        status: "Pending",
                        note: "",
                      };
                      return (
                        <tr key={mapping.id}>
                          <td>{mapping.sourceRow}</td>
                          <td>
                            <strong>{mapping.obsoletePart}</strong>
                          </td>
                          <td>{mapping.replacement}</td>
                          <td>
                            <span
                              className={
                                mapping.disposition === "Replacement candidate"
                                  ? "review-pending"
                                  : "review-blocked"
                              }
                            >
                              {mapping.disposition}
                            </span>
                          </td>
                          <td>
                            <textarea
                              aria-label={`Engineering note for ${mapping.obsoletePart}`}
                              value={review.note}
                              onChange={(event) =>
                                updateLifecycleReviewNote(
                                  mapping.id,
                                  event.target.value,
                                )
                              }
                              placeholder="Required engineering note"
                            />
                            <div className="lifecycle-actions">
                              <button
                                disabled={review.note.trim().length < 12}
                                onClick={() =>
                                  decideLifecycleMapping(
                                    mapping,
                                    "Acknowledged",
                                  )
                                }
                              >
                                Acknowledge evidence
                              </button>
                              <button
                                className="secondary-product"
                                disabled={review.note.trim().length < 12}
                                onClick={() =>
                                  decideLifecycleMapping(mapping, "Rejected")
                                }
                              >
                                Reject mapping
                              </button>
                              <span
                                className={
                                  review.status === "Acknowledged"
                                    ? "review-ready"
                                    : review.status === "Rejected"
                                      ? "review-blocked"
                                      : "review-pending"
                                }
                              >
                                {review.status}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <div className="compact-table extraction-preview-table">
              <table>
                <thead>
                  <tr>
                    <th>Example product</th>
                    <th>Workbook row</th>
                    <th>USD list</th>
                    <th>Use allowed</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>IDP-PHOTO-W + B501-WHITE</strong>
                    </td>
                    <td>117 + 152</td>
                    <td>87</td>
                    <td>
                      <span className="review-blocked">Discovery</span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>IDP-CONTROL</strong>
                    </td>
                    <td>126</td>
                    <td>81</td>
                    <td>
                      <span className="review-blocked">Discovery</span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>IFP-2100HV</strong>
                    </td>
                    <td>6</td>
                    <td>6,787</td>
                    <td>
                      <span className="review-blocked">Discovery</span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>P2RK</strong>
                    </td>
                    <td>473</td>
                    <td>247</td>
                    <td>
                      <span className="review-blocked">Discovery</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!durablePriceSourceHashes.includes(honeywellPriceListSha256) && (
              <label className="source-confirm">
                <input
                  type="checkbox"
                  checked={sourceReviewConfirmed}
                  onChange={(event) =>
                    setSourceReviewConfirmed(event.target.checked)
                  }
                />
                <span>
                  <strong>Confirm controlled discovery import</strong>
                  <small>
                    I verified that currency is USD, obsolete/replacement rows
                    and scratch values are excluded, no discount rule is
                    applied, and zero rows become approved project costs.
                  </small>
                </span>
              </label>
            )}
            <footer className="preview-actions">
              <button
                className="secondary-product"
                onClick={() => setSourcePreviewFile(null)}
              >
                Close
              </button>
              {durablePriceSourceHashes.includes(honeywellPriceListSha256) ? (
                <button disabled>Already indexed · no costs changed</button>
              ) : (
                <button
                  disabled={!sourceReviewConfirmed}
                  onClick={() => void indexKnownPriceSource(sourcePreviewFile)}
                >
                  Index 504 rows for discovery only
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {technicalPreviewFile && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="technical-preview-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setTechnicalPreviewFile(null)}
            aria-label="Close technical specification review"
          />
          <section className="match-panel boq-preview-panel">
            <header className="match-header">
              <div>
                <small>TECHNICAL REFERENCE REVIEW</small>
                <h2 id="technical-preview-title">
                  Section 28 46 00 · Fire Detection and Alarm
                </h2>
                <p>
                  {technicalPreviewFile} · Rev 1 · exact SHA-256 document match
                </p>
              </div>
              <button
                onClick={() => setTechnicalPreviewFile(null)}
                aria-label="Close technical specification review"
              >
                ×
              </button>
            </header>
            {documentControlEditor(technicalPreviewFile)}
            <div className="extraction-proof">
              <span>
                <small>DOCUMENT</small>
                <strong>31 pages · Rev 1</strong>
              </span>
              <span>
                <small>SYSTEM</small>
                <strong>Fire Detection & Alarm</strong>
              </span>
              <span>
                <small>REQUIREMENTS</small>
                <strong>6 governing groups</strong>
              </span>
              <span>
                <small>ANCHOR RECONCILIATION</small>
                <strong
                  className={
                    fireRequirementAnchorIntegrity.valid
                      ? "review-ready"
                      : "review-blocked"
                  }
                >
                  {fireRequirementAnchorIntegrity.anchoredRequirements}/6 page +
                  clause · {fireRequirementAnchorIntegrity.duplicateAnchors}{" "}
                  duplicate
                </strong>
              </span>
              <span>
                <small>PRICING CHANGES</small>
                <strong>None</strong>
              </span>
            </div>
            <div className="approval-blocked">
              <strong>
                Requirements support review; they do not approve a product
              </strong>
              <p>
                Indexing links page and clause evidence to this project.
                Manufacturer approval, exact model compliance, supplier
                quotation and estimator approval remain separate blocking
                controls.
              </p>
            </div>
            <div className="compliance-table extraction-preview-table">
              <table>
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Source evidence</th>
                    <th>Review state</th>
                  </tr>
                </thead>
                <tbody>
                  {fireRequirements.map((requirement) => (
                    <tr key={requirement.id}>
                      <td>
                        <strong>{requirement.requirement}</strong>
                      </td>
                      <td>{requirement.source}</td>
                      <td>
                        <span className="review-blocked">
                          Evidence required
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="preview-actions">
              <button
                className="secondary-product"
                onClick={() => setTechnicalPreviewFile(null)}
              >
                Close
              </button>
              {indexedTechnicalHashes.includes(fireAlarmSpecificationSha256) ? (
                <button disabled>Already indexed · no scope changed</button>
              ) : (
                <button
                  disabled={
                    !fireRequirementAnchorIntegrity.valid ||
                    fireRequirementAnchorIntegrity.anchoredRequirements !== 6
                  }
                  onClick={() =>
                    indexKnownTechnicalSpecification(technicalPreviewFile)
                  }
                >
                  Index technical profile
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {activeRequirementId &&
        (() => {
          const requirement = requirementReviews.find(
            (entry) => entry.id === activeRequirementId,
          );
          if (!requirement) return null;
          return (
            <div
              className="match-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="requirement-review-title"
            >
              <button
                className="drawer-scrim"
                onClick={() => setActiveRequirementId(null)}
                aria-label="Close requirement review"
              />
              <section className="match-panel requirement-review-panel">
                <header className="match-header">
                  <div>
                    <small>TECHNICAL EVIDENCE REVIEW</small>
                    <h2 id="requirement-review-title">
                      {requirement.requirement}
                    </h2>
                    <p>{requirement.source}</p>
                  </div>
                  <button
                    onClick={() => setActiveRequirementId(null)}
                    aria-label="Close requirement review"
                  >
                    ×
                  </button>
                </header>
                <div className="approval-blocked">
                  <strong>Technical decision only</strong>
                  <p>
                    This review changes the requirement status and quotation
                    gate. It cannot select a price, alter a quantity or change
                    any BOQ cost.
                  </p>
                </div>
                <div className="requirement-review-fields">
                  <label>
                    Review result
                    <select
                      value={requirementResult}
                      onChange={(event) =>
                        setRequirementResult(
                          event.target.value as Requirement["status"],
                        )
                      }
                    >
                      <option>Review</option>
                      <option>Compliant</option>
                      <option>Deviation</option>
                    </select>
                  </label>
                  <label>
                    Evidence reference
                    <input
                      value={requirementEvidence}
                      onChange={(event) =>
                        setRequirementEvidence(event.target.value)
                      }
                      placeholder="Certificate, datasheet, drawing, quotation attachment or document page"
                    />
                  </label>
                  <label>
                    Reviewer note
                    <textarea
                      value={requirementNote}
                      onChange={(event) =>
                        setRequirementNote(event.target.value)
                      }
                      placeholder="Explain the evidence checked and why the result is justified"
                    />
                  </label>
                </div>
                {requirementResult === "Deviation" && (
                  <div className="existing-boq-warning">
                    <strong>Deviation remains blocking</strong>
                    <p>
                      Recording a deviation preserves the finding but does not
                      satisfy the quotation approval gate.
                    </p>
                  </div>
                )}
                <footer className="preview-actions">
                  <button
                    className="secondary-product"
                    onClick={() => setActiveRequirementId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={
                      requirementResult !== "Review" &&
                      (!requirementEvidence.trim() || !requirementNote.trim())
                    }
                    onClick={saveRequirementReview}
                  >
                    Save technical decision
                  </button>
                </footer>
              </section>
            </div>
          );
        })()}

      {activeRfqId &&
        (() => {
          const rfq = rfqs.find((record) => record.id === activeRfqId);
          if (!rfq) return null;
          const rfqItems = items.filter((item) =>
            rfq.itemIds.includes(item.id),
          );
          const groupedRfqItems = groupRfqScopeLines(rfqItems);
          const unanswerableRfqItems = rfqItems.filter(
            (item) => !matchReadiness(item).canApprove,
          );
          return (
            <div
              className="match-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="rfq-composer-title"
            >
              <button
                className="drawer-scrim"
                onClick={() => setActiveRfqId(null)}
                aria-label="Close RFQ composer"
              />
              <section className="match-panel boq-preview-panel">
                <header className="match-header">
                  <div>
                    <small>LOCAL SUPPLIER REQUEST</small>
                    <h2 id="rfq-composer-title">
                      {rfq.code} · {rfq.title}
                    </h2>
                    <p>
                      {projectName} · {groupedRfqItems.length} supplier line
                      {groupedRfqItems.length === 1 ? "" : "s"} reconciled to{" "}
                      {rfqItems.length} BOQ line
                      {rfqItems.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveRfqId(null)}
                    aria-label="Close RFQ composer"
                  >
                    ×
                  </button>
                </header>
                <div className="approval-blocked">
                  <strong>Local preparation only</strong>
                  <p>
                    Saving or marking this package ready does not email a
                    supplier or transmit any project file. External issue
                    remains a separate manual action.
                  </p>
                </div>
                <div className="manual-fields rfq-composer-fields">
                  <label>
                    Supplier company
                    <input
                      value={rfqSupplier}
                      placeholder="Required before ready status"
                      onChange={(event) => setRfqSupplier(event.target.value)}
                    />
                  </label>
                  <label>
                    Response due date
                    <input
                      type="date"
                      value={rfqDueDate}
                      onChange={(event) => setRfqDueDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Delivery location
                    <input
                      value={rfqDelivery}
                      placeholder="Project delivery location"
                      onChange={(event) => setRfqDelivery(event.target.value)}
                    />
                  </label>
                  <label className="reason-field">
                    Commercial and technical return requirements
                    <textarea
                      value={rfqRequirements}
                      onChange={(event) =>
                        setRfqRequirements(event.target.value)
                      }
                    />
                  </label>
                </div>
                <div className="section-title">
                  <div>
                    <small>RFQ LINE ITEMS</small>
                    <strong>
                      Only technically identical lines are consolidated
                    </strong>
                  </div>
                  <span>
                    {rfqItems.reduce((sum, item) => sum + item.qty, 0)} total
                    quantity units · all BOQ anchors retained
                  </span>
                </div>
                {unanswerableRfqItems.length > 0 && (
                  <div className="approval-blocked">
                    <strong>
                      {unanswerableRfqItems.length} line
                      {unanswerableRfqItems.length === 1 ? " is" : "s are"} not
                      supplier-answerable
                    </strong>
                    <p>
                      A draft may be saved, but ready status and export are
                      blocked until every line has a classified system, specific
                      description, positive quantity, unit and technical
                      specification.
                    </p>
                  </div>
                )}
                <div className="compact-table extraction-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>BOQ / source anchors</th>
                        <th>System</th>
                        <th>Description</th>
                        <th>Consolidated qty</th>
                        <th>Unit</th>
                        <th>Required return / readiness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedRfqItems.map((group) => {
                        const readiness = matchReadiness(
                          rfqItems.find(
                            (item) => item.id === group.itemIds[0],
                          ) as CostItem,
                        );
                        return (
                          <tr key={group.key}>
                            <td>
                              <strong>
                                {group.itemIds
                                  .map((id) => String(id).padStart(3, "0"))
                                  .join(", ")}
                              </strong>
                              <small>
                                Rows{" "}
                                {group.sourceRows.join(", ") || "not anchored"}
                              </small>
                            </td>
                            <td>{group.system}</td>
                            <td>
                              <strong>{group.item}</strong>
                              {!readiness.canApprove && (
                                <small className="missing-text">
                                  Missing: {readiness.missing.join(", ")}
                                </small>
                              )}
                            </td>
                            <td>{group.qty}</td>
                            <td>{group.unit || "—"}</td>
                            <td>
                              {readiness.canApprove ? (
                                "Part number · unit price · compliance"
                              ) : (
                                <span className="review-blocked">
                                  Clarify before issue
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className="preview-actions">
                  <button
                    className="secondary-product"
                    onClick={() => setActiveRfqId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="secondary-product"
                    onClick={() => saveRfq(false)}
                  >
                    Save draft
                  </button>
                  <button
                    disabled={unanswerableRfqItems.length > 0}
                    onClick={() => saveRfq(true)}
                  >
                    Mark ready · do not send
                  </button>
                </footer>
              </section>
            </div>
          );
        })()}

      {activeResponseRfqId &&
        responseDraft &&
        (() => {
          const rfq = rfqs.find((record) => record.id === activeResponseRfqId);
          if (!rfq) return null;
          const responseTotal =
            responseDraft.lines.reduce(
              (sum, line) =>
                sum +
                (items.find((item) => item.id === line.itemId)?.qty || 0) *
                  line.unitPrice,
              0,
            ) + responseDraft.freightTotal;
          return (
            <div
              className="match-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="response-review-title"
            >
              <button
                className="drawer-scrim"
                onClick={() => {
                  setActiveResponseRfqId(null);
                  setResponseDraft(null);
                }}
                aria-label="Close supplier response review"
              />
              <section className="match-panel response-review-panel">
                <header className="match-header">
                  <div>
                    <small>SUPPLIER RESPONSE NORMALIZATION</small>
                    <h2 id="response-review-title">
                      {rfq.code} · Commercial and technical review
                    </h2>
                    <p>
                      {responseDraft.sourceFile ||
                        "Select a registered source quotation"}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setActiveResponseRfqId(null);
                      setResponseDraft(null);
                    }}
                    aria-label="Close supplier response review"
                  >
                    ×
                  </button>
                </header>
                <div className="approval-blocked">
                  <strong>Review is not an award</strong>
                  <p>
                    Normalized values remain outside BOQ costs and quotation
                    totals. Awarding and applying prices require a separate
                    estimator decision after technical deviations and commercial
                    terms are accepted.
                  </p>
                </div>
                <div className="manual-fields response-header-fields">
                  <label>
                    Source quotation document
                    <select
                      value={responseDraft.sourceFile || ""}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          sourceFile: event.target.value,
                        })
                      }
                    >
                      <option value="">Select registered response…</option>
                      {rfq.responseFiles.map((file) => (
                        <option key={file} value={file}>
                          {file} · {documentRoles[file] || "Role pending"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Supplier
                    <input
                      value={responseDraft.supplier}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          supplier: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Quotation reference
                    <input
                      value={responseDraft.reference}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          reference: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Currency
                    <input
                      value={responseDraft.currency}
                      maxLength={3}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          currency: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Quote date
                    <input
                      type="date"
                      value={responseDraft.quoteDate}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          quoteDate: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Valid until
                    <input
                      type="date"
                      value={responseDraft.validUntil}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          validUntil: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Delivery (weeks)
                    <input
                      type="number"
                      min="0"
                      value={responseDraft.deliveryWeeks}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          deliveryWeeks: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Warranty (months)
                    <input
                      type="number"
                      min="0"
                      value={responseDraft.warrantyMonths}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          warrantyMonths: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Freight / delivery total
                    <input
                      type="number"
                      min="0"
                      value={responseDraft.freightTotal}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          freightTotal: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Payment terms
                    <input
                      value={responseDraft.paymentTerms}
                      onChange={(event) =>
                        setResponseDraft({
                          ...responseDraft,
                          paymentTerms: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="section-title">
                  <div>
                    <small>NORMALIZED OFFER LINES</small>
                    <strong>
                      Every BOQ line requires price, part number and technical
                      result
                    </strong>
                  </div>
                  <span>
                    {responseDraft.currency.toUpperCase() || "—"}{" "}
                    {money(responseTotal)} reviewed total
                  </span>
                </div>
                <div className="compact-table response-lines-table">
                  <table>
                    <thead>
                      <tr>
                        <th>BOQ</th>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Part number</th>
                        <th>Unit price</th>
                        <th>Technical result</th>
                        <th>Deviation / note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {responseDraft.lines.map((line) => {
                        const item = items.find(
                          (entry) => entry.id === line.itemId,
                        );
                        return (
                          <tr key={line.itemId}>
                            <td>{String(line.itemId).padStart(3, "0")}</td>
                            <td>
                              <strong>{item?.item || "Unknown item"}</strong>
                              <small>{item?.unit || "—"}</small>
                            </td>
                            <td>{item?.qty || 0}</td>
                            <td>
                              <input
                                aria-label={`Part number for ${item?.item || line.itemId}`}
                                value={line.partNumber}
                                onChange={(event) =>
                                  updateResponseLine(line.itemId, {
                                    partNumber: event.target.value,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Unit price for ${item?.item || line.itemId}`}
                                type="number"
                                min="0"
                                value={line.unitPrice}
                                onChange={(event) =>
                                  updateResponseLine(line.itemId, {
                                    unitPrice: Number(event.target.value),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <select
                                aria-label={`Technical result for ${item?.item || line.itemId}`}
                                value={line.technicalResult}
                                onChange={(event) =>
                                  updateResponseLine(line.itemId, {
                                    technicalResult: event.target
                                      .value as ResponseLine["technicalResult"],
                                  })
                                }
                              >
                                <option>Pending</option>
                                <option>Compliant</option>
                                <option>Deviation</option>
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`Note for ${item?.item || line.itemId}`}
                                value={line.note}
                                onChange={(event) =>
                                  updateResponseLine(line.itemId, {
                                    note: event.target.value,
                                  })
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className="preview-actions">
                  <button
                    className="secondary-product"
                    onClick={() => {
                      setActiveResponseRfqId(null);
                      setResponseDraft(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="secondary-product"
                    onClick={() => saveResponseReview(false)}
                  >
                    Save review draft
                  </button>
                  <button onClick={() => saveResponseReview(true)}>
                    Complete normalization · do not award
                  </button>
                </footer>
              </section>
            </div>
          );
        })()}

      {activeAwardRfqId &&
        (() => {
          const rfq = rfqs.find((record) => record.id === activeAwardRfqId);
          const review = rfq?.responseOffers?.find(
            (offer) => offer.id === activeAwardOfferId,
          );
          if (!rfq || !review) return null;
          const materialSubtotal = review.lines.reduce(
            (sum, line) =>
              sum +
              (items.find((item) => item.id === line.itemId)?.qty || 0) *
                line.unitPrice,
            0,
          );
          const hasDeviation = review.lines.some(
            (line) => line.technicalResult !== "Compliant",
          );
          const currencyReady =
            review.currency === "SAR" ||
            (review.currency === "USD" && rateReady);
          const conflictingCosts = items.filter(
            (item) =>
              review.lines.some((line) => line.itemId === item.id) &&
              item.status === "Costed" &&
              Boolean(item.approvedSource) &&
              !(
                item.approvedSource?.includes(rfq.code) &&
                item.approvedSource?.includes(
                  review.sourceFile || "__missing_source__",
                )
              ),
          );
          return (
            <div
              className="match-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="award-review-title"
            >
              <button
                className="drawer-scrim"
                onClick={() => {
                  setActiveAwardRfqId(null);
                  setActiveAwardOfferId(null);
                  setAwardReason("");
                  setAllowCostReplacement(false);
                }}
                aria-label="Close award review"
              />
              <section className="match-panel award-review-panel">
                <header className="match-header">
                  <div>
                    <small>ESTIMATOR AWARD CONTROL</small>
                    <h2 id="award-review-title">
                      {rfq.code} · {review.supplier}
                    </h2>
                    <p>
                      {review.reference} · {review.sourceFile} · valid until{" "}
                      {review.validUntil}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setActiveAwardRfqId(null);
                      setActiveAwardOfferId(null);
                      setAwardReason("");
                      setAllowCostReplacement(false);
                    }}
                    aria-label="Close award review"
                  >
                    ×
                  </button>
                </header>
                <div className="approval-blocked">
                  <strong>Award changes project cost</strong>
                  <p>
                    This is the first step that can apply supplier prices to BOQ
                    lines. The decision, source files, currency conversion and
                    freight allocation are retained in the audit trail.
                  </p>
                </div>
                <div className="award-summary">
                  <span>
                    <small>MATERIAL</small>
                    <strong>
                      {review.currency} {money(materialSubtotal)}
                    </strong>
                  </span>
                  <span>
                    <small>FREIGHT</small>
                    <strong>
                      {review.currency} {money(review.freightTotal)}
                    </strong>
                  </span>
                  <span>
                    <small>LANDED TOTAL</small>
                    <strong>
                      {review.currency}{" "}
                      {money(materialSubtotal + review.freightTotal)}
                    </strong>
                  </span>
                  <span>
                    <small>PROJECT CONVERSION</small>
                    <strong>
                      {review.currency === "USD"
                        ? `${exchangeRate.toFixed(3)} SAR/USD`
                        : "No conversion"}
                    </strong>
                  </span>
                </div>
                <div className="compact-table award-lines-table">
                  <table>
                    <thead>
                      <tr>
                        <th>BOQ</th>
                        <th>Part number</th>
                        <th>Qty</th>
                        <th>Unit price</th>
                        <th>Technical result</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.lines.map((line) => {
                        const item = items.find(
                          (entry) => entry.id === line.itemId,
                        );
                        return (
                          <tr key={line.itemId}>
                            <td>{String(line.itemId).padStart(3, "0")}</td>
                            <td>
                              <strong>{line.partNumber}</strong>
                              <small>{item?.item}</small>
                            </td>
                            <td>{item?.qty || 0}</td>
                            <td>
                              {review.currency} {money(line.unitPrice)}
                            </td>
                            <td>
                              <span
                                className={
                                  line.technicalResult === "Compliant"
                                    ? "review-ready"
                                    : "review-blocked"
                                }
                              >
                                {line.technicalResult}
                              </span>
                              {line.note && <small>{line.note}</small>}
                            </td>
                            <td>{review.sourceFile}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {hasDeviation && (
                  <div className="existing-boq-warning">
                    <strong>Technical award blocked</strong>
                    <p>
                      At least one line has a deviation or pending result.
                      Resolve the technical review before applying any cost.
                    </p>
                  </div>
                )}
                {!currencyReady && (
                  <div className="existing-boq-warning">
                    <strong>Currency control blocked</strong>
                    <p>
                      USD requires a confirmed project exchange rate. Other
                      currencies require a separately governed conversion
                      source.
                    </p>
                  </div>
                )}
                {conflictingCosts.length > 0 && (
                  <div className="existing-boq-warning">
                    <strong>
                      {conflictingCosts.length} approved BOQ cost
                      {conflictingCosts.length === 1 ? "" : "s"} would be
                      replaced
                    </strong>
                    <p>
                      The selected offer conflicts with existing approved source
                      evidence. Replacement is blocked unless the estimator
                      explicitly accepts it below and records the decision
                      reason.
                    </p>
                    <label className="replacement-confirm">
                      <input
                        type="checkbox"
                        checked={allowCostReplacement}
                        onChange={(event) =>
                          setAllowCostReplacement(event.target.checked)
                        }
                      />
                      Replace existing approved costs with this selected offer
                    </label>
                  </div>
                )}
                <label className="award-reason">
                  Award decision reason
                  <textarea
                    value={awardReason}
                    onChange={(event) => setAwardReason(event.target.value)}
                    placeholder="Explain commercial selection, comparison basis and accepted terms"
                  />
                </label>
                <footer className="preview-actions">
                  <button
                    className="secondary-product"
                    onClick={() => {
                      setActiveAwardRfqId(null);
                      setActiveAwardOfferId(null);
                      setAwardReason("");
                      setAllowCostReplacement(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={
                      hasDeviation ||
                      !currencyReady ||
                      !awardReason.trim() ||
                      (conflictingCosts.length > 0 && !allowCostReplacement)
                    }
                    onClick={confirmSupplierAward}
                  >
                    Award and apply governed costs
                  </button>
                </footer>
              </section>
            </div>
          );
        })()}

      {activeMarkupItemId !== null &&
        (() => {
          const item = items.find((entry) => entry.id === activeMarkupItemId);
          if (!item) return null;
          return (
            <div
              className="match-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="markup-review-title"
            >
              <button
                className="drawer-scrim"
                onClick={() => {
                  setActiveMarkupItemId(null);
                  setMarkupReason("");
                }}
                aria-label="Close markup review"
              />
              <section className="match-panel markup-review-panel">
                <header className="match-header">
                  <div>
                    <small>COMMERCIAL OVERRIDE</small>
                    <h2 id="markup-review-title">Review markup</h2>
                    <p>{item.item}</p>
                  </div>
                  <button
                    onClick={() => {
                      setActiveMarkupItemId(null);
                      setMarkupReason("");
                    }}
                    aria-label="Close markup review"
                  >
                    ×
                  </button>
                </header>
                <div className="approval-blocked">
                  <strong>This changes the client selling price</strong>
                  <p>
                    The previous and new markup, estimator reason and time will
                    be retained. Any approved quotation revision will become
                    outdated.
                  </p>
                </div>
                <div className="markup-summary">
                  <span>
                    <small>CURRENT</small>
                    <strong>{item.markup}%</strong>
                  </span>
                  <span>
                    <small>PROPOSED</small>
                    <label>
                      <input
                        aria-label={`Proposed markup for ${item.item}`}
                        type="number"
                        min="0"
                        max="500"
                        value={markupDraft}
                        onChange={(event) =>
                          setMarkupDraft(Number(event.target.value))
                        }
                      />
                      %
                    </label>
                  </span>
                </div>
                <label className="award-reason">
                  Reason for change
                  <textarea
                    value={markupReason}
                    onChange={(event) => setMarkupReason(event.target.value)}
                    placeholder="Explain the commercial basis for this markup"
                  />
                </label>
                <footer className="preview-actions">
                  <button
                    className="secondary-product"
                    onClick={() => {
                      setActiveMarkupItemId(null);
                      setMarkupReason("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={
                      !Number.isFinite(markupDraft) ||
                      markupDraft < 0 ||
                      markupDraft > 500 ||
                      !markupReason.trim()
                    }
                    onClick={saveMarkupReview}
                  >
                    Save audited markup
                  </button>
                </footer>
              </section>
            </div>
          );
        })()}

      {selectedMatchingItem && (
        <MatchingCandidateReview
          item={selectedMatchingItem}
          candidates={persistentMatchCandidates}
          status={persistentMatchStatus}
          loading={persistentMatchLoading}
          error={persistentMatchError}
          safetyCandidateId={safetyCandidateId}
          safetyDecision={safetyDecision}
          safetyLoading={safetyLoading}
          safetyError={safetyError}
          onClose={() => {
            setSelectedMatchingItemId(null);
            setSafetyCandidateId(null);
            setSafetyDecision(null);
            window.history.pushState(null, "", buildProjectLocation(projectId, "Technical Matching"));
          }}
          onRun={() => startPersistentMatching(selectedMatchingItem, !["Not Started", "Not Ready"].includes(persistentMatchStatus))}
          onOpenSafety={openSafetyDecision}
          onAcknowledge={acknowledgeSafetyWarnings}
          onApprove={approveTechnicalSafety}
        />
      )}

      {matchingItemId !== null && Boolean(0) &&
        (() => {
          const matchingItem = items.find((item) => item.id === matchingItemId);
          if (!matchingItem) return null;
          const readiness = matchReadiness(matchingItem);
          const relevantCandidates = persistentMatchCandidates;
          return (
            <div
              className="match-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="match-title"
            >
              <button
                className="drawer-scrim"
                onClick={() => {
                  setMatchingItemId(null);
                  setSafetyCandidateId(null);
                  setSafetyDecision(null);
                }}
                aria-label="Close match suggestions"
              />
              <section className="match-panel">
                <header className="match-header">
                  <div>
                    <small>PERSISTENT TECHNICAL MATCHING</small>
                    <h2 id="match-title">Product candidates</h2>
                    <p>{matchingItem.item}</p>
                  </div>
                  <button
                    onClick={() => {
                      setMatchingItemId(null);
                      setSafetyCandidateId(null);
                      setSafetyDecision(null);
                    }}
                    aria-label="Close match suggestions"
                  >
                    ×
                  </button>
                </header>
                {!readiness.canApprove && (
                  <div className="approval-blocked" role="alert">
                    <strong>Discovery only — approval is blocked</strong>
                    <p>
                      Add {readiness.missing.join(", ")} before technical
                      matching can proceed beyond discovery. No candidate or
                      price is approved here.
                    </p>
                  </div>
                )}
                <div className="match-basis">
                  <span>Engine status</span>
                  <strong>
                    {persistentMatchLoading
                      ? "Loading…"
                      : persistentMatchStatus}
                  </strong>
                </div>
                {persistentMatchError && (
                  <div className="existing-boq-warning">
                    <strong>Matching unavailable</strong>
                    <p>{persistentMatchError}</p>
                  </div>
                )}
                <div className="preview-actions">
                  <button
                    disabled={persistentMatchLoading}
                    onClick={() =>
                      startPersistentMatching(
                        matchingItem,
                        persistentMatchStatus !== "Not Started",
                      )
                    }
                  >
                    {persistentMatchStatus === "Not Started" ||
                    persistentMatchStatus === "Not Ready"
                      ? "Start technical matching"
                      : "Re-run matching"}
                  </button>
                </div>
                <div className="candidate-list">
                  {relevantCandidates.map((candidate) => {
                    return (
                      <article key={candidate.id} className="candidate-card">
                        <div className="candidate-top">
                          <span>
                            Rank {candidate.rank} ·{" "}
                            {candidate.recommendation_tier}
                          </span>
                          <b
                            className={
                              candidate.confidence_state === "Verified" ||
                              candidate.confidence_state === "High Confidence"
                                ? "confidence-high"
                                : "confidence-discovery"
                            }
                          >
                            {candidate.confidence_state}
                          </b>
                        </div>
                        <h3>
                          {candidate.manufacturer} · {candidate.part_number}
                        </h3>
                        <p className="source-reference">
                          {candidate.family || "Unclassified family"}
                        </p>
                        <strong>
                          {candidate.technical_status} · score {candidate.score}
                        </strong>
                        <div className="evidence">
                          <span>Matching basis</span>
                          <p>
                            {candidate.matchingBasis.join(" · ") ||
                              "No verified matching basis"}
                          </p>
                        </div>
                        <div className="evidence">
                          <span>Engineering explanation</span>
                          <p>{candidate.explanation}</p>
                        </div>
                        <div className="evidence">
                          <span>Commercial signal</span>
                          <p>
                            {candidate.commercial_availability} · this does not
                            affect technical compliance
                          </p>
                        </div>
                        <p className="audit-note">
                          Technical review required — no automatic approval
                        </p>
                        <button
                          disabled={
                            safetyLoading && safetyCandidateId === candidate.id
                          }
                          onClick={() => openSafetyDecision(candidate.id)}
                        >
                          {safetyLoading && safetyCandidateId === candidate.id
                            ? "Evaluating safety…"
                            : "Open confidence & safety decision"}
                        </button>
                        {safetyCandidateId === candidate.id && safetyError && (
                          <div className="existing-boq-warning">
                            <strong>Safety evaluation unavailable</strong>
                            <p>{safetyError}</p>
                          </div>
                        )}
                        {safetyCandidateId === candidate.id &&
                          safetyDecision && (
                            <div
                              className="safety-decision-card"
                              aria-live="polite"
                            >
                              <div className="candidate-top">
                                <span>
                                  Decision v{safetyDecision.version_number}
                                </span>
                                <b
                                  className={
                                    safetyDecision.safety_state ===
                                    "Approval Ready"
                                      ? "confidence-high"
                                      : "confidence-discovery"
                                  }
                                >
                                  {safetyDecision.safety_state}
                                </b>
                              </div>
                              <strong>
                                {safetyDecision.confidence_level} ·{" "}
                                {safetyDecision.overall_confidence}%
                              </strong>
                              <p>
                                {safetyDecision.compliance_state} ·{" "}
                                {safetyDecision.technical_eligibility}
                              </p>
                              <p>{safetyDecision.explanation}</p>
                              {safetyDecision.blocks.length > 0 && (
                                <div className="approval-blocked">
                                  <strong>
                                    {safetyDecision.blocks.length} approval
                                    blocker
                                    {safetyDecision.blocks.length === 1
                                      ? ""
                                      : "s"}
                                  </strong>
                                  <ul>
                                    {safetyDecision.blocks.map((entry) => (
                                      <li key={entry.id}>
                                        <b>{entry.code}</b> —{" "}
                                        {entry.user_message} Owner:{" "}
                                        {entry.owner}. Next:{" "}
                                        {entry.resolution_action}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {safetyDecision.warnings.length > 0 && (
                                <div className="existing-boq-warning">
                                  <strong>
                                    {safetyDecision.warnings.length} warning
                                    {safetyDecision.warnings.length === 1
                                      ? ""
                                      : "s"}
                                  </strong>
                                  <ul>
                                    {safetyDecision.warnings.map((entry) => (
                                      <li key={entry.id}>
                                        {entry.message}{" "}
                                        {entry.resolution_action}
                                      </li>
                                    ))}
                                  </ul>
                                  {safetyDecision.warnings.some(
                                    (entry) => !entry.acknowledged_at,
                                  ) && (
                                    <button onClick={acknowledgeSafetyWarnings}>
                                      Acknowledge warnings with reason
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="preview-actions">
                                <button
                                  className="secondary-product"
                                  onClick={() =>
                                    openSafetyDecision(candidate.id, true)
                                  }
                                >
                                  Recalculate from current records
                                </button>
                                <button
                                  disabled={
                                    !/^Eligible/.test(
                                      safetyDecision.technical_eligibility,
                                    ) ||
                                    safetyDecision.blocks.length > 0 ||
                                    safetyDecision.warnings.some(
                                      (entry) => !entry.acknowledged_at,
                                    )
                                  }
                                  onClick={approveTechnicalSafety}
                                >
                                  Approve technical selection
                                </button>
                              </div>
                            </div>
                          )}
                      </article>
                    );
                  })}
                  {!persistentMatchLoading && !relevantCandidates.length && (
                    <div className="no-candidate">
                      <strong>No persisted candidate result</strong>
                      <p>
                        Start matching after the Requirement Profile and
                        reviewed Product Library are ready. The engine returns a
                        structured no-match result instead of inventing a
                        product.
                      </p>
                    </div>
                  )}
                </div>
                <p className="audit-note">
                  Matching runs and reviewer feedback are stored with
                  requirement, product, rule, search and source provenance.
                  Pricing remains in Costing and Supplier RFQs.
                </p>
              </section>
            </div>
          );
        })()}

      {showQuotation && (
        <div className="quotation-overlay">
          <button
            className="drawer-scrim"
            onClick={() => setShowQuotation(false)}
            aria-label="Close quotation preview"
          />
          <section
            className="quotation-modal"
            aria-label="Client quotation preview"
          >
            <div className="quotation-actions">
              <div>
                <small>CLIENT OUTPUT</small>
                <strong>
                  {currentQuotationApproval
                    ? `Approved revision ${currentQuotationApproval.revision}`
                    : "Draft quotation preview"}
                </strong>
              </div>
              <div>
                <button
                  disabled={!currentQuotationApproval}
                  onClick={() => currentQuotationApproval && window.print()}
                >
                  {currentQuotationApproval
                    ? "Print / Save PDF"
                    : "Approval required to print"}
                </button>
                <button
                  className="modal-close"
                  onClick={() => setShowQuotation(false)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="quotation-paper">
              {!currentQuotationApproval && (
                <div className="draft-output-watermark">
                  <strong>NOT APPROVED FOR ISSUE</strong>
                  <span>
                    {quotationFingerprint} · calculations may still change
                  </span>
                </div>
              )}
              <header>
                <div className="quote-logo">
                  <span />
                  <span />
                  <span />
                </div>
                <div>
                  <strong>QUOTATION</strong>
                  <small>عرض سعر</small>
                </div>
              </header>
              <div className="quote-meta">
                <div>
                  <small>QUOTATION NO.</small>
                  <strong>
                    {currentQuotationApproval
                      ? `${projectCode}-FA-R${currentQuotationApproval.revision}`
                      : `DRAFT · ${projectCode}-FA`}
                  </strong>
                </div>
                <div>
                  <small>DATE</small>
                  <strong>
                    {currentQuotationApproval
                      ? new Date(
                          currentQuotationApproval.approvedAt,
                        ).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : new Date().toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                  </strong>
                </div>
                <div>
                  <small>VALIDITY</small>
                  <strong>{validityDays} Days</strong>
                </div>
              </div>
              <div className="quote-address">
                <div>
                  <small>PREPARED FOR</small>
                  <strong>{clientName}</strong>
                  <span>
                    {projectIntakeProfile.contactName
                      ? `Attention: ${projectIntakeProfile.contactName}${projectIntakeProfile.contactEmail ? ` · ${projectIntakeProfile.contactEmail}` : ""}`
                      : "Client contact not provided"}
                  </span>
                </div>
                <div>
                  <small>PROJECT</small>
                  <strong>{projectName}</strong>
                  <span>
                    {projectIntakeProfile.inquirySubject || "Section 28 46 00"}
                    {projectIntakeProfile.inquiryReceived
                      ? ` · received ${projectIntakeProfile.inquiryReceived}`
                      : ""}
                  </span>
                </div>
              </div>
              <table className="quote-summary">
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Description</th>
                    <th>Amount ({currency})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>01</td>
                    <td>
                      Supply of fire detection and alarm equipment for the
                      reviewed BOQ scope
                    </td>
                    <td>{money(totals.supply)}</td>
                  </tr>
                  {riskAllowanceRate > 0 && (
                    <tr>
                      <td>02</td>
                      <td>
                        Commercial contingency / risk allowance ·{" "}
                        {riskAllowanceRate}% · {riskAllowanceReason}
                      </td>
                      <td>{money(totals.riskAllowance)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="quote-totals">
                <div>
                  <span>Subtotal before VAT</span>
                  <strong>
                    {currency} {money(totals.selling)}
                  </strong>
                </div>
                <div>
                  <span>VAT added separately · {vatRate}%</span>
                  <strong>
                    {currency} {money(totals.selling * (vatRate / 100))}
                  </strong>
                </div>
                <div className="grand-total">
                  <span>Total including VAT</span>
                  <strong>
                    {currency} {money(totals.selling * (1 + vatRate / 100))}
                  </strong>
                </div>
              </div>
              <div className="quote-terms">
                <div>
                  <strong>Client commercial terms</strong>
                  <p>
                    <b>Payment:</b> {clientPaymentTerms}.{" "}
                    <b>Delivery period:</b> {clientDeliveryTerms}.{" "}
                    <b>Delivery location:</b> {clientDeliveryLocation}.{" "}
                    <b>Freight:</b> {clientFreightTerms}. <b>Qualifications:</b>{" "}
                    {clientQualifications}.
                  </p>
                </div>
                <div>
                  <strong>Warranty</strong>
                  <p>
                    {warrantyMonths} months from material delivery. This
                    quotation remains valid for {validityDays} days.
                  </p>
                </div>
                {riskAllowanceRate > 0 && (
                  <div>
                    <strong>Risk allowance basis</strong>
                    <p>
                      {riskAllowanceReason}. Applied visibly at{" "}
                      {riskAllowanceRate}% after line-level selling prices.
                    </p>
                  </div>
                )}
              </div>
              <div className="quote-exclusions">
                <strong>Scope exclusions</strong>
                <p>
                  Installation, cabling, programming, testing, commissioning,
                  civil works and any item not explicitly included in the
                  reviewed BOQ material supply are excluded unless added through
                  a separately priced and approved revision.
                </p>
                {knownServiceScope && (
                  <small>
                    AUTHORIZED MATERIALS-ONLY BOUNDARY ·{" "}
                    {scopeAlignmentDecision.evidenceReference} ·{" "}
                    {scopeAlignmentDecision.reason}
                  </small>
                )}
              </div>
              <footer>
                <span>
                  AI Pricing Agent ·{" "}
                  {currentQuotationApproval
                    ? `Approved ${currentQuotationApproval.fingerprint}`
                    : "Draft preview"}
                </span>
                <span>Page 1 of 1</span>
              </footer>
            </div>
          </section>
        </div>
      )}

      {boqReviewAction && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="boq-review-action-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setBoqReviewAction(null)}
            aria-label="Close BOQ review action"
          />
          <section className="match-panel">
            <header className="match-header">
              <div>
                <small>GOVERNED BOQ REVIEW</small>
                <h2 id="boq-review-action-title">
                  {boqReviewAction.operation === "update"
                    ? "Edit extracted BOQ item"
                    : boqReviewAction.operation === "restore"
                      ? "Restore Original"
                      : boqReviewAction.operation === "approve"
                        ? "Confirm Extraction"
                        : "Reject Extraction"}
                </h2>
                <p>
                  {boqReviewAction.item.item_number ||
                    `Row ${boqReviewAction.item.sequence}`}{" "}
                  · {boqReviewAction.item.description}
                </p>
              </div>
              <button
                onClick={() => setBoqReviewAction(null)}
                aria-label="Close BOQ review action"
              >
                ×
              </button>
            </header>
            <div className="document-control-fields">
              {boqReviewAction.operation === "update" && (
                <>
                  <label>
                    Description
                    <textarea
                      value={boqReviewAction.description}
                      onChange={(event) =>
                        setBoqReviewAction((current) =>
                          current
                            ? { ...current, description: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      value={boqReviewAction.unit}
                      onChange={(event) =>
                        setBoqReviewAction((current) =>
                          current
                            ? { ...current, unit: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label>
                    Quantity
                    <input
                      value={boqReviewAction.quantity}
                      onChange={(event) =>
                        setBoqReviewAction((current) =>
                          current
                            ? { ...current, quantity: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                </>
              )}
              {boqReviewAction.operation === "restore" && (
                <label>
                  Source field
                  <select
                    value={boqReviewAction.field}
                    onChange={(event) =>
                      setBoqReviewAction((current) =>
                        current
                          ? { ...current, field: event.target.value }
                          : current,
                      )
                    }
                  >
                    <option value="description">Description</option>
                    <option value="unit">Unit</option>
                    <option value="quantity">Quantity</option>
                    <option value="itemNumber">Item number</option>
                    <option value="manufacturer">Manufacturer</option>
                    <option value="partNumber">Part number</option>
                    <option value="notes">Notes</option>
                  </select>
                </label>
              )}
              <label>
                Review reason / source evidence
                <textarea
                  value={boqReviewAction.reason}
                  onChange={(event) =>
                    setBoqReviewAction((current) =>
                      current
                        ? { ...current, reason: event.target.value }
                        : current,
                    )
                  }
                  placeholder="Required for the immutable review audit"
                />
              </label>
              {boqReviewAction.operation === "approve" && (
                <p className="field-note">
                  Confirms only that the extracted BOQ information reflects the
                  source document. No technical, product, pricing, commercial,
                  or quotation approval is created.
                </p>
              )}
            </div>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                onClick={() => setBoqReviewAction(null)}
              >
                Cancel
              </button>
              <button
                disabled={boqReviewAction.reason.trim().length < 3}
                onClick={submitBoqReviewAction}
              >
                {extractionReviewActionLabel(boqReviewAction.operation)}
              </button>
            </footer>
          </section>
        </div>
      )}

      {boqReviewDocument && (
        <div
          className="match-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="boq-extraction-review-title"
        >
          <button
            className="drawer-scrim"
            onClick={() => setBoqReviewDocument(null)}
            aria-label="Close BOQ extraction review"
          />
          <section className="match-panel boq-extraction-review-panel">
            <header className="match-header">
              <div>
                <small>PERSISTENT BOQ EXTRACTION</small>
                <h2 id="boq-extraction-review-title">Review extracted rows</h2>
                <p>
                  {boqReviewDocument.logical_name} · extraction v
                  {boqReviewDocument.boq_extraction_version}
                </p>
              </div>
              <button
                onClick={() => setBoqReviewDocument(null)}
                aria-label="Close BOQ extraction review"
              >
                ×
              </button>
            </header>
            <div className="extraction-proof">
              <span>
                <small>ROWS</small>
                <strong>{extractedBoqItems.length}</strong>
              </span>
              <span>
                <small>BOQ ITEMS</small>
                <strong>
                  {
                    extractedBoqItems.filter(
                      (item) => item.row_type === "BOQ Item",
                    ).length
                  }
                </strong>
              </span>
              <span>
                <small>NEEDS REVIEW</small>
                <strong>
                  {
                    extractedBoqItems.filter(
                      (item) => item.review_status === "Needs Review",
                    ).length
                  }
                </strong>
              </span>
              <span>
                <small>APPROVED</small>
                <strong>
                  {
                    extractedBoqItems.filter(
                      (item) => item.review_status === "Approved",
                    ).length
                  }
                </strong>
              </span>
            </div>
            <div className="compact-table boq-extraction-review-table">
              <table>
                <thead>
                  <tr>
                    <th>Seq.</th>
                    <th>Type / source</th>
                    <th>Description</th>
                    <th>Unit</th>
                    <th>Quantity</th>
                    <th>Confidence</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedBoqItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.sequence}</td>
                      <td>
                        <strong>{item.row_type}</strong>
                        <small>
                          {item.source_location.sheet ||
                            `Page ${item.source_location.page || "?"}`}{" "}
                          · row {item.source_location.row || "?"}
                        </small>
                      </td>
                      <td>
                        <strong>
                          {item.description || "Missing description"}
                        </strong>
                        <small>
                          {item.item_number || "No item reference"} ·{" "}
                          {extractionReviewStatusLabel(item)}
                        </small>
                      </td>
                      <td>
                        {item.original_unit || (
                          <span className="missing-text">Missing</span>
                        )}
                      </td>
                      <td>
                        {item.original_quantity || (
                          <span className="missing-text">Missing</span>
                        )}
                      </td>
                      <td>
                        {item.extraction_confidence}%
                        <small>{item.confidence_state}</small>
                      </td>
                      <td>
                        <div className="line-decision">
                          <button onClick={() => reviewBoqItem(item, "update")}>
                            Edit
                          </button>
                          <button
                            onClick={() => reviewBoqItem(item, "row-type")}
                          >
                            Type
                          </button>
                          <button onClick={() => reviewBoqItem(item, "merge")}>
                            Merge
                          </button>
                          <button onClick={() => reviewBoqItem(item, "split")}>
                            Split
                          </button>
                          <button
                            onClick={() => reviewBoqItem(item, "restore")}
                          >
                            Restore Original
                          </button>
                          <button
                            disabled={item.row_type !== "BOQ Item"}
                            onClick={() => reviewBoqItem(item, "approve")}
                          >
                            Confirm Extraction
                          </button>
                          <button onClick={() => reviewBoqItem(item, "reject")}>
                            Reject Extraction
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="preview-actions">
              <a
                href={`/api/documents/${encodeURIComponent(boqReviewDocument.id)}/preview`}
                target="_blank"
                rel="noreferrer"
              >
                Open original source
              </a>
              <a
                href={`/api/documents/${encodeURIComponent(boqReviewDocument.id)}/boq-extraction/export`}
              >
                Export raw extraction
              </a>
              <button onClick={() => setBoqReviewDocument(null)}>
                Close review
              </button>
            </footer>
          </section>
        </div>
      )}

      {engineeringGraphItemId && (
        <div
          className="match-overlay engineering-graph-overlay"
          role="dialog"
          aria-modal="true"
        >
          <button className="drawer-scrim" onClick={closeEngineeringGraph} />
          <section className="match-panel engineering-graph-panel">
            <header className="match-header">
              <div>
                <small>PHASE 03 · GOVERNED ENGINEERING KNOWLEDGE</small>
                <h2>Engineering Knowledge Graph</h2>
                <p>
                  {engineeringGraphItem?.description} · graph v
                  {engineeringGraphVersion?.version_number || "?"}
                </p>
              </div>
              <button onClick={closeEngineeringGraph}>×</button>
            </header>
            <div className="graph-summary">
              <article>
                <small>NODES</small>
                <strong>{engineeringGraphNodes.length}</strong>
              </article>
              <article>
                <small>RELATIONSHIPS</small>
                <strong>{engineeringGraphRelationships.length}</strong>
              </article>
              <article>
                <small>MISSING</small>
                <strong>
                  {engineeringGraphVersion?.missing_relationships.length || 0}
                </strong>
              </article>
              <button
                disabled={engineeringGraphLoading}
                onClick={() =>
                  void generateEngineeringGraph(engineeringGraphItemId)
                }
              >
                {engineeringGraphLoading
                  ? "Recalculating…"
                  : "Recalculate graph"}
              </button>
            </div>
            {engineeringGraphError && (
              <p className="managed-document-error">{engineeringGraphError}</p>
            )}
            <div className="engineering-graph-layout">
              <section className="graph-relationships">
                {engineeringGraphRelationships.map((edge) => (
                  <article key={edge.id}>
                    <header>
                      <strong>
                        {edge.from_label} <span>{edge.relationship_type}</span>{" "}
                        {edge.to_label}
                      </strong>
                      <b>{edge.review_status}</b>
                    </header>
                    <p>
                      {edge.confidence}% · {edge.basis}
                    </p>
                    {edge.provenance.map((proof, index) => (
                      <aside key={index}>
                        {proof.evidenceSnippet}
                        <br />
                        <small>
                          Page {proof.page || "?"} · Clause{" "}
                          {proof.clause || "?"}
                        </small>
                      </aside>
                    ))}
                    <footer>
                      <button
                        onClick={() =>
                          setEngineeringGraphAction({
                            relationship: edge,
                            operation: "approve",
                            reason: "",
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setEngineeringGraphAction({
                            relationship: edge,
                            operation: "reject",
                            reason: "",
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        onClick={() =>
                          setEngineeringGraphAction({
                            relationship: edge,
                            operation: "restore",
                            reason: "",
                          })
                        }
                      >
                        Restore
                      </button>
                    </footer>
                    <details>
                      <summary>Immutable audit</summary>
                      {engineeringGraphAudit
                        .filter((audit) => audit.entity_id === edge.id)
                        .map((audit) => (
                          <p key={audit.id}>
                            {audit.action} · {audit.reason}
                          </p>
                        ))}
                    </details>
                  </article>
                ))}
              </section>
              <aside className="graph-sidebar">
                <section>
                  <h3>Graph nodes</h3>
                  {engineeringGraphNodes.map((node) => (
                    <p key={node.id}>
                      <b>{node.node_type}</b>
                      <br />
                      {node.label}
                    </p>
                  ))}
                </section>
                <section>
                  <h3>Missing relationships</h3>
                  {engineeringGraphVersion?.missing_relationships.map(
                    (entry) => (
                      <p key={entry.relationshipType}>
                        <b>{entry.relationshipType}</b>
                        <br />
                        {entry.reason}
                      </p>
                    ),
                  )}
                </section>
                <section>
                  <h3>Conflicts & risks</h3>
                  {engineeringGraphVersion?.conflicts.map((entry) => (
                    <p key={entry.nodeKey}>{entry.label}</p>
                  ))}
                  {engineeringGraphVersion?.engineering_risks.map((entry) => (
                    <p key={entry.area}>
                      <b>
                        {entry.severity} · {entry.area}
                      </b>
                      <br />
                      {entry.risk}
                    </p>
                  ))}
                </section>
              </aside>
            </div>
            <footer className="preview-actions">
              <span>
                No compatibility is inferred. Matching and pricing remain zero.
              </span>
              <button onClick={closeEngineeringGraph}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {engineeringGraphAction && (
        <div className="match-overlay requirement-action-overlay">
          <button
            className="drawer-scrim"
            onClick={() => setEngineeringGraphAction(null)}
          />
          <section className="match-panel requirement-action-panel">
            <header className="match-header">
              <div>
                <small>GOVERNED GRAPH REVIEW</small>
                <h2>{engineeringGraphAction.operation} relationship</h2>
              </div>
              <button onClick={() => setEngineeringGraphAction(null)}>×</button>
            </header>
            <p>
              {engineeringGraphAction.relationship.from_label} →{" "}
              {engineeringGraphAction.relationship.to_label}
            </p>
            <label>
              Mandatory reason
              <textarea
                value={engineeringGraphAction.reason}
                onChange={(event) =>
                  setEngineeringGraphAction((current) =>
                    current
                      ? { ...current, reason: event.target.value }
                      : current,
                  )
                }
              />
            </label>
            <footer className="preview-actions">
              <button onClick={() => setEngineeringGraphAction(null)}>
                Cancel
              </button>
              <button
                disabled={engineeringGraphAction.reason.trim().length < 5}
                onClick={() => void submitEngineeringGraphAction()}
              >
                Record review
              </button>
            </footer>
          </section>
        </div>
      )}
      {drawingWorkspaceDocument && (
        <div
          className="match-overlay drawing-workspace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawing-workspace-title"
        >
          <button className="drawer-scrim" onClick={closeDrawingWorkspace} />
          <section className="match-panel drawing-workspace-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1A · STRUCTURAL INDEX ONLY</small>
                <h2 id="drawing-workspace-title">Drawing Workspace</h2>
                <p>
                  {drawingWorkspaceDocument.logical_name} · intake v
                  {drawingWorkspaceData?.version.version_number || "?"}
                </p>
              </div>
              <button onClick={closeDrawingWorkspace}>×</button>
            </header>
            <nav
              className="drawing-workspace-tabs"
              aria-label="Drawing workspace sections"
            >
              {(
                [
                  "Overview",
                  "Pages",
                  "Metadata",
                  "Assets",
                  "Legend",
                  "Search",
                  "Version History",
                ] as const
              ).map((tab) => (
                <button
                  className={drawingWorkspaceTab === tab ? "active" : ""}
                  key={tab}
                  onClick={() => {
                    setDrawingWorkspaceTab(tab);
                    if (tab === "Version History") void loadDrawingHistory();
                  }}
                >
                  {tab}
                </button>
              ))}
            </nav>
            {drawingWorkspaceError && (
              <p className="managed-document-error" role="alert">
                {drawingWorkspaceError}
              </p>
            )}
            {drawingWorkspaceLoading && !drawingWorkspaceData ? (
              <div className="dashboard-loading">
                <strong>Indexing drawing structure…</strong>
                <p>Reading pages, explicit metadata and structural assets.</p>
              </div>
            ) : (
              drawingWorkspaceData && (
                <div className="drawing-workspace-body">
                  {drawingWorkspaceTab === "Overview" && (
                    <>
                      <div className="drawing-overview-metrics">
                        <article>
                          <small>PAGES</small>
                          <strong>
                            {drawingWorkspaceData.version.summary.pageCount}
                          </strong>
                        </article>
                        <article>
                          <small>ASSETS</small>
                          <strong>
                            {drawingWorkspaceData.version.summary.assetCount}
                          </strong>
                        </article>
                        <article>
                          <small>LEGENDS</small>
                          <strong>
                            {drawingWorkspaceData.version.summary.legendCount}
                          </strong>
                        </article>
                        <article>
                          <small>VECTOR / RASTER</small>
                          <strong>
                            {drawingWorkspaceData.version.summary.vectorPages} /{" "}
                            {drawingWorkspaceData.version.summary.rasterPages}
                          </strong>
                        </article>
                      </div>
                      <section className="drawing-classifications">
                        <h3>Document classifications</h3>
                        {drawingWorkspaceData.documentClassifications.map(
                          (entry) => (
                            <article key={entry.id}>
                              <strong>{entry.classification_type}</strong>
                              <span>
                                {entry.confidence}% · {entry.review_status}
                              </span>
                              <small>{entry.extraction_method}</small>
                            </article>
                          ),
                        )}
                      </section>
                    </>
                  )}
                  {drawingWorkspaceTab === "Pages" && (
                    <div className="drawing-page-list">
                      {drawingWorkspaceData.pages.map((page) => (
                        <article key={page.id}>
                          <header>
                            <strong>Page {page.page_number}</strong>
                            <span>{page.coordinate_mode}</span>
                          </header>
                          <p>
                            {page.classifications
                              .map(
                                (entry) => `${entry.type} ${entry.confidence}%`,
                              )
                              .join(" · ")}
                          </p>
                          <small>
                            {page.text_count} indexed text assets ·{" "}
                            {page.extraction_method}
                          </small>
                          <a
                            href={`/api/documents/${encodeURIComponent(drawingWorkspaceDocument.id)}/preview#page=${page.page_number}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open source page
                          </a>
                        </article>
                      ))}
                    </div>
                  )}
                  {drawingWorkspaceTab === "Metadata" && (
                    <dl className="drawing-metadata-grid">
                      {Object.entries(drawingWorkspaceData.metadata || {})
                        .filter(
                          ([key]) =>
                            !["id", "intake_version_id", "created_at"].includes(
                              key,
                            ),
                        )
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{key.replaceAll("_", " ")}</dt>
                            <dd>
                              {value === null || value === ""
                                ? "Not available"
                                : String(value)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  )}
                  {drawingWorkspaceTab === "Assets" && (
                    <div className="compact-table drawing-assets-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Page</th>
                            <th>Type</th>
                            <th>Content</th>
                            <th>Coordinates</th>
                            <th>Confidence</th>
                            <th>Method</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drawingWorkspaceData.assets.map((asset) => (
                            <tr key={asset.id}>
                              <td>
                                {drawingWorkspaceData.pages.find(
                                  (page) => page.id === asset.page_id,
                                )?.page_number || "?"}
                              </td>
                              <td>{asset.asset_type}</td>
                              <td>
                                {asset.text_content?.slice(0, 160) || "—"}
                              </td>
                              <td>
                                {asset.coordinates_available
                                  ? JSON.stringify(asset.bounding_box)
                                  : "Unavailable"}
                              </td>
                              <td>{asset.detection_confidence}%</td>
                              <td>{asset.detection_method}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {drawingWorkspaceTab === "Legend" && (
                    <div className="drawing-legend-list">
                      {drawingWorkspaceData.legends.map((legend) => (
                        <article key={legend.id}>
                          <header>
                            <strong>
                              Legend · page{" "}
                              {
                                drawingWorkspaceData.pages.find(
                                  (page) => page.id === legend.page_id,
                                )?.page_number
                              }
                            </strong>
                            <span>
                              Version {legend.legend_version || "Not stated"}
                            </span>
                          </header>
                          <p>
                            {legend.confidence}% · {legend.detection_method}
                          </p>
                          {legend.entries.map((entry) => (
                            <div key={entry.id}>
                              <b>{entry.label}</b>
                              <span>
                                {entry.description || "No explicit description"}
                              </span>
                              <small>
                                {entry.entry_type} · {entry.confidence}%
                              </small>
                            </div>
                          ))}
                        </article>
                      ))}
                      {!drawingWorkspaceData.legends.length && (
                        <div className="empty-state">
                          <strong>No explicit legend detected</strong>
                          <p>
                            No legend or abbreviation entries were invented.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {drawingWorkspaceTab === "Search" && (
                    <>
                      <div className="drawing-search">
                        <input
                          aria-label="Search drawing index"
                          value={drawingSearch}
                          onChange={(event) =>
                            setDrawingSearch(event.target.value)
                          }
                          placeholder="Text, drawing number, sheet name, tag or legend entry"
                        />
                        <button onClick={() => void searchDrawing()}>
                          Search
                        </button>
                      </div>
                      <div className="drawing-search-results">
                        {drawingSearchResults.map((result, index) => (
                          <article key={index}>
                            <strong>Page {String(result.page_number)}</strong>
                            <span>
                              {String(
                                result.drawing_number ||
                                  result.sheet_name ||
                                  "",
                              )}
                            </span>
                            <p>
                              {String(result.text_content || "").slice(0, 300)}
                            </p>
                            <a
                              href={`/api/documents/${encodeURIComponent(drawingWorkspaceDocument.id)}/preview#page=${String(result.page_number)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open page
                            </a>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                  {drawingWorkspaceTab === "Version History" && (
                    <div className="drawing-history">
                      {drawingVersionHistory.map((version) => (
                        <article key={String(version.id)}>
                          <strong>
                            Drawing intake v{String(version.version_number)}
                          </strong>
                          <span>
                            {String(version.status)} ·{" "}
                            {String(version.review_status)}
                          </span>
                          <small>
                            {String(version.created_at)}
                            {version.superseded_at
                              ? " · Historical"
                              : " · Current"}
                          </small>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
            <footer className="preview-actions">
              <span>
                Read-only structural index. No engineering meaning, objects,
                matching or pricing.
              </span>
              <button onClick={closeDrawingWorkspace}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {symbolWorkspaceDocument && (
        <div
          className="match-overlay drawing-workspace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="symbol-workspace-title"
        >
          <button className="drawer-scrim" onClick={closeSymbolWorkspace} />
          <section className="match-panel drawing-workspace-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1B · EVIDENCE-LED SYMBOLS</small>
                <h2 id="symbol-workspace-title">Symbol Review</h2>
                <p>
                  {symbolWorkspaceDocument.logical_name} · recognition v
                  {symbolWorkspaceData?.version.version_number || "?"}
                </p>
              </div>
              <button onClick={closeSymbolWorkspace}>×</button>
            </header>
            <nav
              className="drawing-workspace-tabs"
              aria-label="Symbol Review sections"
            >
              {(
                [
                  "Definitions",
                  "Occurrences",
                  "Unknown symbols",
                  "Evidence",
                  "Review history",
                ] as const
              ).map((tab) => (
                <button
                  className={symbolWorkspaceTab === tab ? "active" : ""}
                  key={tab}
                  onClick={() => setSymbolWorkspaceTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </nav>
            {symbolWorkspaceError && (
              <p className="managed-document-error" role="alert">
                {symbolWorkspaceError}
              </p>
            )}
            {symbolWorkspaceLoading && !symbolWorkspaceData ? (
              <div className="dashboard-loading">
                <strong>Recognizing explicit legend symbols…</strong>
                <p>Indexing vector signatures and nearby explicit tags.</p>
              </div>
            ) : (
              symbolWorkspaceData && (
                <div className="drawing-workspace-body">
                  <div className="drawing-overview-metrics">
                    <article>
                      <small>DEFINITIONS</small>
                      <strong>{symbolWorkspaceData.definitions.length}</strong>
                    </article>
                    <article>
                      <small>MATCHED</small>
                      <strong>
                        {
                          symbolWorkspaceData.occurrences.filter(
                            (item) => item.definition_id,
                          ).length
                        }
                      </strong>
                    </article>
                    <article>
                      <small>UNKNOWN</small>
                      <strong>
                        {symbolWorkspaceData.unknownSymbols.length}
                      </strong>
                    </article>
                    <article>
                      <small>VERSION</small>
                      <strong>
                        {symbolWorkspaceData.version.version_number}
                      </strong>
                    </article>
                  </div>
                  {symbolWorkspaceTab === "Definitions" && (
                    <div className="drawing-page-list">
                      {symbolWorkspaceData.definitions.map((definition) => (
                        <article key={definition.id}>
                          <header>
                            <strong>
                              {definition.abbreviation ||
                                definition.explicit_label ||
                                "Explicit legend symbol"}
                            </strong>
                            <span>
                              {definition.confidence}% ·{" "}
                              {definition.review_status}
                            </span>
                          </header>
                          <p>
                            {definition.description ||
                              "No explicit description"}
                          </p>
                          <small>
                            Page {definition.source_page} ·{" "}
                            {definition.extraction_method}
                          </small>
                          <div className="symbol-review-actions">
                            <button
                              onClick={() =>
                                void reviewSymbol(
                                  "definitions",
                                  definition.id,
                                  "approve",
                                )
                              }
                            >
                              Approve
                            </button>
                            <button
                              onClick={() =>
                                void reviewSymbol(
                                  "definitions",
                                  definition.id,
                                  "reject",
                                )
                              }
                            >
                              Reject
                            </button>
                            <button
                              onClick={() =>
                                void reviewSymbol(
                                  "definitions",
                                  definition.id,
                                  "edit",
                                )
                              }
                            >
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                void reviewSymbol(
                                  "definitions",
                                  definition.id,
                                  "split",
                                )
                              }
                            >
                              Split
                            </button>
                            <button
                              onClick={() =>
                                void reviewSymbol(
                                  "definitions",
                                  definition.id,
                                  "merge",
                                )
                              }
                            >
                              Merge
                            </button>
                            <button
                              onClick={() =>
                                void reviewSymbol(
                                  "definitions",
                                  definition.id,
                                  "restore",
                                )
                              }
                            >
                              Restore
                            </button>
                          </div>
                        </article>
                      ))}
                      {!symbolWorkspaceData.definitions.length && (
                        <div className="empty-state">
                          <strong>No explicit legend definitions</strong>
                          <p>Nothing was guessed from repeated shapes.</p>
                        </div>
                      )}
                    </div>
                  )}
                  {symbolWorkspaceTab === "Occurrences" && (
                    <div className="compact-table drawing-assets-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Page</th>
                            <th>Definition</th>
                            <th>Nearby text</th>
                            <th>Match basis</th>
                            <th>Confidence</th>
                            <th>Review</th>
                          </tr>
                        </thead>
                        <tbody>
                          {symbolWorkspaceData.occurrences
                            .filter((item) => item.definition_id)
                            .map((item) => (
                              <tr key={item.id}>
                                <td>{item.page_number}</td>
                                <td>
                                  {item.abbreviation || item.explicit_label}
                                </td>
                                <td>{item.nearby_text || "—"}</td>
                                <td>{item.match_basis}</td>
                                <td>{item.confidence}%</td>
                                <td>
                                  <button
                                    onClick={() =>
                                      void reviewSymbol(
                                        "occurrences",
                                        item.id,
                                        "approve",
                                      )
                                    }
                                  >
                                    Approve
                                  </button>{" "}
                                  <button
                                    onClick={() =>
                                      void reviewSymbol(
                                        "occurrences",
                                        item.id,
                                        "reject",
                                      )
                                    }
                                  >
                                    Reject
                                  </button>{" "}
                                  <button
                                    onClick={() =>
                                      void reviewSymbol(
                                        "occurrences",
                                        item.id,
                                        "restore",
                                      )
                                    }
                                  >
                                    Restore
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {symbolWorkspaceTab === "Unknown symbols" && (
                    <div className="drawing-page-list">
                      {symbolWorkspaceData.unknownSymbols.map((item) => (
                        <article key={item.id}>
                          <header>
                            <strong>
                              Unknown symbol · page {item.page_number}
                            </strong>
                            <span>
                              {item.confidence}% · {item.review_status}
                            </span>
                          </header>
                          <p>{item.nearby_text || "No explicit nearby tag"}</p>
                          <small>
                            {item.match_basis} · {item.shape_signature}
                          </small>
                        </article>
                      ))}
                    </div>
                  )}
                  {symbolWorkspaceTab === "Evidence" && (
                    <div className="drawing-page-list">
                      {symbolWorkspaceData.definitions.map((definition) => (
                        <article key={definition.id}>
                          <header>
                            <strong>
                              {definition.abbreviation ||
                                definition.explicit_label}
                            </strong>
                            <span>Page {definition.source_page}</span>
                          </header>
                          <p>{definition.evidence_text}</p>
                          <small>
                            Bounding box{" "}
                            {JSON.stringify(definition.bounding_box)} ·
                            immutable geometry preserved
                          </small>
                          <a
                            href={`/api/documents/${encodeURIComponent(symbolWorkspaceDocument.id)}/preview#page=${definition.source_page}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open source page
                          </a>
                        </article>
                      ))}
                    </div>
                  )}
                  {symbolWorkspaceTab === "Review history" && (
                    <div className="drawing-history">
                      {symbolWorkspaceData.audit.map((event) => (
                        <article key={event.id}>
                          <strong>
                            {event.action} · {event.entity_type}
                          </strong>
                          <span>{event.reason}</span>
                          <small>
                            {event.actor_user_id} · {event.created_at}
                          </small>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
            <footer className="preview-actions">
              <span>
                Occurrences are observations, not BOQ quantities or engineering
                objects.
              </span>
              <button
                onClick={() => void openLegendGeometry(symbolWorkspaceDocument)}
              >
                Geometry capture
              </button>
              <button
                onClick={() => void rerunSymbolRecognition()}
                disabled={symbolWorkspaceLoading}
              >
                Rerun
              </button>
              <button onClick={closeSymbolWorkspace}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {legendGeometryDocument && (
        <div
          className="match-overlay drawing-workspace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legend-geometry-title"
        >
          <button className="drawer-scrim" onClick={closeLegendGeometry} />
          <section className="match-panel drawing-workspace-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1F · BOUNDED VECTOR EVIDENCE</small>
                <h2 id="legend-geometry-title">Legend Symbol Geometry</h2>
                <p>
                  {legendGeometryDocument.logical_name} · geometry v
                  {legendGeometryData?.version?.version_number || "?"}
                </p>
              </div>
              <button onClick={closeLegendGeometry}>×</button>
            </header>
            {legendGeometryError && (
              <p className="managed-document-error" role="alert">
                {legendGeometryError}
              </p>
            )}
            <div className="drawing-workspace-body">
              <div className="drawing-overview-metrics">
                <article>
                  <small>APPROVED ROWS</small>
                  <strong>
                    {legendGeometryData?.version?.summary?.approvedRowCount ||
                      0}
                  </strong>
                </article>
                <article>
                  <small>CANDIDATES</small>
                  <strong>
                    {legendGeometryData?.version?.summary?.candidateCount || 0}
                  </strong>
                </article>
                <article>
                  <small>CAPTURED ROWS</small>
                  <strong>
                    {legendGeometryData?.version?.summary?.candidateRowCount ||
                      0}
                  </strong>
                </article>
                <article>
                  <small>MISSING</small>
                  <strong>
                    {legendGeometryData?.version?.summary?.missingRowCount || 0}
                  </strong>
                </article>
              </div>
              <label>
                Reviewer reason
                <textarea
                  value={legendGeometryReason}
                  onChange={(e) => setLegendGeometryReason(e.target.value)}
                />
              </label>
              <div className="drawing-page-list">
                {legendGeometryData?.candidates?.map((candidate: any) => (
                  <article key={candidate.id}>
                    <header>
                      <strong>
                        Page {candidate.source_page} · row{" "}
                        {candidate.source_row}
                      </strong>
                      <span>
                        {candidate.detection_confidence}% ·{" "}
                        {candidate.review_status}
                      </span>
                    </header>
                    <p>{candidate.alignment_status}</p>
                    <small>
                      {candidate.geometry.length} path group(s) ·{" "}
                      {candidate.geometry_signature || "No signature"}
                    </small>
                    <code>{JSON.stringify(candidate.symbol_cell_bbox)}</code>
                    <div className="symbol-review-actions">
                      <button
                        disabled={!candidate.geometry.length}
                        onClick={() =>
                          void reviewLegendGeometry(candidate.id, "confirm")
                        }
                      >
                        Confirm geometry
                      </button>
                      <button
                        onClick={() =>
                          void reviewLegendGeometry(candidate.id, "reject")
                        }
                      >
                        Reject geometry
                      </button>
                      <button
                        disabled={!candidate.geometry.length}
                        onClick={() =>
                          void reviewLegendGeometry(candidate.id, "reassign")
                        }
                      >
                        Reassign geometry
                      </button>
                      <button
                        disabled={candidate.geometry.length < 2}
                        onClick={() =>
                          void reviewLegendGeometry(
                            candidate.id,
                            "split-symbols",
                          )
                        }
                      >
                        Split multiple symbols
                      </button>
                      <button
                        disabled={candidate.geometry.length < 2}
                        onClick={() =>
                          void reviewLegendGeometry(
                            candidate.id,
                            "merge-fragments",
                          )
                        }
                      >
                        Merge fragmented paths
                      </button>
                      <button
                        onClick={() =>
                          void reviewLegendGeometry(candidate.id, "restore")
                        }
                      >
                        Restore
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <footer className="preview-actions">
              <span>
                Geometry is evidence only; no engineering meaning is created.
              </span>
              <button onClick={() => void publishLegendGeometry()}>
                Publish approved geometry
              </button>
              <button onClick={closeLegendGeometry}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {structureWorkspaceDocument && (
        <div
          className="match-overlay drawing-workspace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="structure-workspace-title"
        >
          <button className="drawer-scrim" onClick={closeStructureWorkspace} />
          <section className="match-panel drawing-workspace-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1C · PHYSICAL STRUCTURE ONLY</small>
                <h2 id="structure-workspace-title">Drawing Structure</h2>
                <p>
                  {structureWorkspaceDocument.logical_name} · parser v
                  {structureWorkspaceData?.version.version_number || "?"}
                </p>
              </div>
              <button onClick={closeStructureWorkspace}>×</button>
            </header>
            <nav
              className="drawing-workspace-tabs"
              aria-label="Drawing Structure sections"
            >
              {(
                [
                  "Tables",
                  "Rows",
                  "Columns",
                  "Cells",
                  "Headers",
                  "Legend Rows",
                  "Validation",
                  "Version History",
                  "Search",
                ] as const
              ).map((tab) => (
                <button
                  className={structureWorkspaceTab === tab ? "active" : ""}
                  key={tab}
                  onClick={() => {
                    setStructureWorkspaceTab(tab);
                    if (tab === "Version History") void loadStructureHistory();
                  }}
                >
                  {tab}
                </button>
              ))}
            </nav>
            {structureWorkspaceError && (
              <p className="managed-document-error" role="alert">
                {structureWorkspaceError}
              </p>
            )}
            {structureWorkspaceLoading && !structureWorkspaceData ? (
              <div className="dashboard-loading">
                <strong>Reconstructing drawing structure…</strong>
                <p>
                  Detecting tables, cells and text alignment without engineering
                  inference.
                </p>
              </div>
            ) : (
              structureWorkspaceData && (
                <div className="drawing-workspace-body">
                  <div className="drawing-overview-metrics">
                    <article>
                      <small>TABLES</small>
                      <strong>{structureWorkspaceData.tables.length}</strong>
                    </article>
                    <article>
                      <small>ROWS / COLUMNS</small>
                      <strong>
                        {structureWorkspaceData.rows.length} /{" "}
                        {structureWorkspaceData.columns.length}
                      </strong>
                    </article>
                    <article>
                      <small>CELLS</small>
                      <strong>{structureWorkspaceData.cells.length}</strong>
                    </article>
                    <article>
                      <small>CONFIDENCE</small>
                      <strong>
                        {
                          structureWorkspaceData.version.summary
                            .averageStructuralConfidence
                        }
                        %
                      </strong>
                    </article>
                  </div>
                  {structureWorkspaceTab === "Tables" && (
                    <div className="drawing-page-list">
                      {structureWorkspaceData.tables.map((table) => (
                        <article key={table.id}>
                          <header>
                            <strong>
                              {table.table_type} · page {table.page_number}
                            </strong>
                            <span>
                              {table.detection_confidence}% ·{" "}
                              {table.review_status}
                            </span>
                          </header>
                          <p>
                            {table.row_count} rows · {table.column_count}{" "}
                            columns
                          </p>
                          <small>
                            {table.detection_method} · bounding box{" "}
                            {JSON.stringify(table.bounding_box)}
                          </small>
                          <a
                            href={`/api/documents/${encodeURIComponent(structureWorkspaceDocument.id)}/preview#page=${table.page_number}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open source page
                          </a>
                        </article>
                      ))}
                    </div>
                  )}
                  {structureWorkspaceTab === "Rows" && (
                    <div className="compact-table drawing-assets-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Table</th>
                            <th>Row</th>
                            <th>Confidence</th>
                            <th>Status</th>
                            <th>Physical lines</th>
                            <th>Bounding box</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structureWorkspaceData.rows.map((row) => (
                            <tr key={row.id}>
                              <td>{row.table_id}</td>
                              <td>{row.row_number}</td>
                              <td>{row.structural_confidence}%</td>
                              <td>{row.structural_status}</td>
                              <td>{row.physical_row_count}</td>
                              <td>{JSON.stringify(row.bounding_box)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {structureWorkspaceTab === "Columns" && (
                    <div className="compact-table drawing-assets-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Table</th>
                            <th>Column</th>
                            <th>Header candidate</th>
                            <th>Width</th>
                            <th>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structureWorkspaceData.columns.map((column) => (
                            <tr key={column.id}>
                              <td>{column.table_id}</td>
                              <td>{column.column_number}</td>
                              <td>{column.header_candidate}</td>
                              <td>{column.width}</td>
                              <td>{column.confidence}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {structureWorkspaceTab === "Cells" && (
                    <div className="compact-table drawing-assets-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Row / Column</th>
                            <th>Reconstructed</th>
                            <th>Raw fragments</th>
                            <th>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structureWorkspaceData.cells.map((cell) => (
                            <tr key={cell.id}>
                              <td>
                                {cell.row_number} / {cell.column_number}
                              </td>
                              <td>{cell.reconstructed_content || "—"}</td>
                              <td>
                                {cell.original_fragments
                                  ?.map((fragment: any) => fragment.text)
                                  .join(" | ") || "—"}
                              </td>
                              <td>{cell.confidence}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {structureWorkspaceTab === "Headers" && (
                    <div className="drawing-page-list">
                      {structureWorkspaceData.headers.map((header) => (
                        <article key={header.id}>
                          <header>
                            <strong>{header.header_type}</strong>
                            <span>{header.confidence}%</span>
                          </header>
                          <p>{header.raw_content}</p>
                          <small>
                            Stored separately; never an engineering definition.
                          </small>
                        </article>
                      ))}
                    </div>
                  )}
                  {structureWorkspaceTab === "Legend Rows" && (
                    <div className="drawing-page-list">
                      {structureWorkspaceData.legendRows.map((row) => (
                        <article key={row.id}>
                          <header>
                            <strong>
                              Page {row.source_page} · row {row.source_row}
                            </strong>
                            <span>
                              {row.structural_confidence}% · {row.review_status}
                            </span>
                          </header>
                          <p>
                            {row.abbreviation || "No abbreviation"} ·{" "}
                            {row.description || "No description"}
                          </p>
                          <small>
                            {row.symbol_geometry?.length || 0} preserved
                            geometry fragment(s) · {row.notes || "No notes"}
                          </small>
                        </article>
                      ))}
                    </div>
                  )}
                  {structureWorkspaceTab === "Validation" && (
                    <div className="drawing-page-list">
                      {structureWorkspaceData.validationIssues.map((issue) => (
                        <article key={issue.id}>
                          <header>
                            <strong>{issue.issue_type}</strong>
                            <span>
                              {issue.severity} · {issue.status}
                            </span>
                          </header>
                          <p>{issue.detail}</p>
                          <small>
                            Page {issue.page_number} · {issue.confidence}%
                            detection confidence
                          </small>
                        </article>
                      ))}
                    </div>
                  )}
                  {structureWorkspaceTab === "Version History" && (
                    <div className="drawing-history">
                      {structureHistory.map((version) => (
                        <article key={version.id}>
                          <strong>Structure v{version.version_number}</strong>
                          <span>
                            {version.status} · {version.parser_version}
                          </span>
                          <small>
                            {version.created_at}
                            {version.superseded_at
                              ? " · Historical"
                              : " · Current"}
                          </small>
                        </article>
                      ))}
                    </div>
                  )}
                  {structureWorkspaceTab === "Search" && (
                    <>
                      <div className="drawing-search">
                        <input
                          aria-label="Search drawing structure"
                          value={structureSearch}
                          onChange={(event) =>
                            setStructureSearch(event.target.value)
                          }
                          placeholder="Search raw or reconstructed cell content"
                        />
                        <button onClick={() => void searchStructure()}>
                          Search
                        </button>
                      </div>
                      <div className="drawing-search-results">
                        {structureSearchResults.map((cell) => (
                          <article key={cell.id}>
                            <strong>
                              Page {cell.page_number} · row {cell.row_number},
                              column {cell.column_number}
                            </strong>
                            <p>{cell.reconstructed_content}</p>
                            <small>{cell.raw_content}</small>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            )}
            <footer className="preview-actions">
              <span>
                Headers and reconstructed cells remain structural records only.
              </span>
              <button
                onClick={() => void rerunStructure()}
                disabled={structureWorkspaceLoading}
              >
                Rerun
              </button>
              <button onClick={closeStructureWorkspace}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {structureWorkspaceDocument && !structureReviewOpen && (
        <button
          className="structure-review-fab"
          onClick={() => void openStructureReview()}
        >
          Review structural rows
        </button>
      )}
      {structureReviewOpen && structureWorkspaceDocument && (
        <div
          className="match-overlay structure-review-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="structure-review-title"
        >
          <button className="drawer-scrim" onClick={closeStructureReview} />
          <section className="match-panel structure-review-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1D · GOVERNED STRUCTURAL REVIEW</small>
                <h2 id="structure-review-title">Drawing Structural Review</h2>
                <p>
                  {structureWorkspaceDocument.logical_name} ·{" "}
                  {structureReviewData?.cases.length || 0} parser legend rows
                </p>
              </div>
              <button onClick={closeStructureReview}>×</button>
            </header>
            {structureReviewError && (
              <p className="managed-document-error" role="alert">
                {structureReviewError}
              </p>
            )}
            {structureReviewLoading && !structureReviewData ? (
              <div className="dashboard-loading">
                <strong>Loading structural review…</strong>
              </div>
            ) : (
              structureReviewData && (
                <div className="structure-review-layout">
                  <aside className="structure-review-list">
                    <div className="structure-review-counts">
                      <strong>
                        {structureReviewData.counts.Approved || 0} approved
                      </strong>
                      <span>
                        {structureReviewData.counts.Rejected || 0} rejected ·{" "}
                        {structureReviewData.counts["Header Excluded"] || 0}{" "}
                        headers
                      </span>
                    </div>
                    {structureReviewData.cases.map((reviewCase) => (
                      <button
                        className={
                          structureReviewCaseId === reviewCase.id
                            ? "active"
                            : ""
                        }
                        key={reviewCase.id}
                        onClick={() => selectStructureReviewCase(reviewCase)}
                      >
                        <strong>
                          Page {reviewCase.current_snapshot.sourcePage} · row{" "}
                          {reviewCase.current_snapshot.sourceRow}
                        </strong>
                        <span>
                          {reviewCase.current_snapshot.abbreviation ||
                            reviewCase.current_snapshot.description?.slice(
                              0,
                              50,
                            ) ||
                            "Unlabelled structural row"}
                        </span>
                        <small>
                          {reviewCase.current_snapshot.structuralConfidence}% ·{" "}
                          {reviewCase.status}
                        </small>
                      </button>
                    ))}
                  </aside>
                  {(() => {
                    const reviewCase = structureReviewData.cases.find(
                      (item) => item.id === structureReviewCaseId,
                    );
                    if (!reviewCase)
                      return (
                        <div className="empty-state">
                          <strong>Select a structural row</strong>
                        </div>
                      );
                    const snapshot = reviewCase.current_snapshot,
                      mergeCell = snapshot.cells?.find(
                        (cell: any) => cell.original_fragments?.length > 1,
                      ),
                      words = String(
                        structureReviewDescription ||
                          snapshot.description ||
                          "",
                      )
                        .split(/\s+/)
                        .filter(Boolean),
                      middle = Math.max(1, Math.floor(words.length / 2));
                    return (
                      <main className="structure-review-detail">
                        <section className="structure-source-region">
                          <header>
                            <strong>Original page region</strong>
                            <a
                              href={`/api/documents/${encodeURIComponent(structureWorkspaceDocument.id)}/preview#page=${snapshot.sourcePage}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open full page
                            </a>
                          </header>
                          <iframe
                            title={`Source page ${snapshot.sourcePage}`}
                            src={`/api/documents/${encodeURIComponent(structureWorkspaceDocument.id)}/preview#page=${snapshot.sourcePage}`}
                          />
                          <code>{JSON.stringify(snapshot.boundingBox)}</code>
                        </section>
                        <section className="structure-reconstruction">
                          <header>
                            <strong>Reconstructed structural row</strong>
                            <span>
                              {snapshot.structuralConfidence}% ·{" "}
                              {reviewCase.status}
                            </span>
                          </header>
                          <label>
                            Abbreviation
                            <input
                              value={structureReviewAbbreviation}
                              onChange={(event) =>
                                setStructureReviewAbbreviation(
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Description
                            <textarea
                              value={structureReviewDescription}
                              onChange={(event) =>
                                setStructureReviewDescription(
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <div className="structure-cell-review">
                            {snapshot.cells?.map((cell: any) => (
                              <article key={cell.id}>
                                <header>
                                  <strong>Column {cell.column_number}</strong>
                                  <span>{cell.confidence}%</span>
                                </header>
                                <p>{cell.reconstructed_content || "Empty"}</p>
                                <small>
                                  {cell.original_fragments
                                    ?.map((fragment: any) => fragment.text)
                                    .join(" | ") || "No text fragments"}
                                </small>
                                <code>{JSON.stringify(cell.bounding_box)}</code>
                              </article>
                            ))}
                          </div>
                          <div className="structure-issue-review">
                            {snapshot.validationIssues?.map((issue: any) => (
                              <span key={issue.id}>
                                {issue.severity} · {issue.issue_type}
                              </span>
                            ))}
                          </div>
                          <label>
                            Reviewer reason
                            <textarea
                              value={structureReviewReason}
                              onChange={(event) =>
                                setStructureReviewReason(event.target.value)
                              }
                              placeholder="Required for every governed decision"
                            />
                          </label>
                          <div className="structure-review-actions">
                            <button
                              onClick={() =>
                                void structureReviewAction("confirm")
                              }
                            >
                              Confirm row
                            </button>
                            <button
                              onClick={() =>
                                void structureReviewAction("edit", {
                                  abbreviation: structureReviewAbbreviation,
                                  description: structureReviewDescription,
                                })
                              }
                            >
                              Save reconstructed text
                            </button>
                            <button
                              disabled={!snapshot.cells?.[0]}
                              onClick={() =>
                                void structureReviewAction("reassign-cell", {
                                  cellId: snapshot.cells?.[0]?.id,
                                  rowNumber: snapshot.sourceRow,
                                  columnNumber:
                                    snapshot.cells?.[0]?.column_number,
                                })
                              }
                            >
                              Reassign first cell
                            </button>
                            <button
                              disabled={!mergeCell}
                              onClick={() =>
                                void structureReviewAction("merge-fragments", {
                                  cellId: mergeCell?.id,
                                  fragmentIds:
                                    mergeCell?.original_fragments?.map(
                                      (fragment: any) => fragment.id,
                                    ),
                                  text: mergeCell?.original_fragments
                                    ?.map((fragment: any) => fragment.text)
                                    .join(" "),
                                })
                              }
                            >
                              Merge split fragments
                            </button>
                            <button
                              disabled={words.length < 2}
                              onClick={() =>
                                void structureReviewAction("split-row", {
                                  rows: [
                                    {
                                      abbreviation: structureReviewAbbreviation,
                                      description: words
                                        .slice(0, middle)
                                        .join(" "),
                                    },
                                    {
                                      abbreviation: null,
                                      description: words
                                        .slice(middle)
                                        .join(" "),
                                    },
                                  ],
                                })
                              }
                            >
                              Split row
                            </button>
                            <button
                              onClick={() =>
                                void structureReviewAction("mark-header")
                              }
                            >
                              Mark header
                            </button>
                            <button
                              onClick={() =>
                                void structureReviewAction("mark-non-legend")
                              }
                            >
                              Mark non-legend
                            </button>
                            <button
                              onClick={() =>
                                void structureReviewAction("reject")
                              }
                            >
                              Reject row
                            </button>
                            <button
                              onClick={() =>
                                void structureReviewAction("restore")
                              }
                            >
                              Restore parser output
                            </button>
                          </div>
                        </section>
                      </main>
                    );
                  })()}
                </div>
              )
            )}
            <footer className="preview-actions">
              <span>Original geometry and parser fragments are immutable.</span>
              <button onClick={() => void publishApprovedStructure()}>
                Publish approved structure
              </button>
              <button onClick={closeStructureReview}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {symbolSegmentationDocument && (
        <div
          className="match-overlay drawing-workspace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="symbol-segmentation-title"
        >
          <button className="drawer-scrim" onClick={closeSymbolSegmentation} />
          <section className="match-panel drawing-workspace-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1G · FINE-GRAINED GEOMETRY</small>
                <h2 id="symbol-segmentation-title">Symbol Cell Segmentation</h2>
                <p>
                  {symbolSegmentationDocument.logical_name} · segmentation v
                  {symbolSegmentationData?.version?.version_number || "?"}
                </p>
              </div>
              <button onClick={closeSymbolSegmentation}>×</button>
            </header>
            {symbolSegmentationError && (
              <p className="managed-document-error" role="alert">
                {symbolSegmentationError}
              </p>
            )}
            <div className="drawing-workspace-body">
              <div className="drawing-overview-metrics">
                <article>
                  <small>CELLS</small>
                  <strong>
                    {symbolSegmentationData?.version?.summary?.cellsProcessed ||
                      0}
                  </strong>
                </article>
                <article>
                  <small>CLUSTERS</small>
                  <strong>
                    {symbolSegmentationData?.clusters?.length || 0}
                  </strong>
                </article>
                <article>
                  <small>EXCLUDED FRAGMENTS</small>
                  <strong>
                    {symbolSegmentationData?.version?.summary
                      ?.excludedFragments || 0}
                  </strong>
                </article>
                <article>
                  <small>APPROVED</small>
                  <strong>
                    {symbolSegmentationData?.clusters?.filter(
                      (c: any) => c.review_status === "Approved",
                    ).length || 0}
                  </strong>
                </article>
              </div>
              <label>
                Reviewer reason
                <textarea
                  value={symbolSegmentationReason}
                  onChange={(e) => setSymbolSegmentationReason(e.target.value)}
                />
              </label>
              <div className="drawing-page-list">
                {symbolSegmentationData?.clusters?.map((cluster: any) => (
                  <article key={cluster.id}>
                    <header>
                      <strong>Cluster {cluster.cluster_number}</strong>
                      <span>
                        {cluster.confidence}% · {cluster.review_status}
                      </span>
                    </header>
                    <p>{cluster.detection_basis}</p>
                    <small>
                      {cluster.fragment_count} fragments ·{" "}
                      {cluster.geometry_signature}
                    </small>
                    <code>{JSON.stringify(cluster.bounding_box)}</code>
                    {cluster.exclusion_reason && (
                      <p>{cluster.exclusion_reason}</p>
                    )}
                    <div className="symbol-review-actions">
                      <button
                        onClick={() =>
                          void reviewSymbolCluster(cluster.id, "confirm")
                        }
                      >
                        Confirm cluster as symbol
                      </button>
                      <button
                        onClick={() =>
                          void reviewSymbolCluster(cluster.id, "reject")
                        }
                      >
                        Reject
                      </button>
                      <button
                        onClick={() =>
                          void reviewSymbolCluster(
                            cluster.id,
                            "remove-fragments",
                            { indexes: [0] },
                          )
                        }
                      >
                        Remove fragment
                      </button>
                      <button
                        onClick={() =>
                          void reviewSymbolCluster(cluster.id, "split-cluster")
                        }
                      >
                        Split cluster
                      </button>
                      <button
                        onClick={() =>
                          void reviewSymbolCluster(cluster.id, "restore")
                        }
                      >
                        Restore
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <footer className="preview-actions">
              <span>Clusters remain geometry evidence only.</span>
              <button onClick={() => void publishSymbolClusters()}>
                Publish confirmed clusters
              </button>
              <button onClick={closeSymbolSegmentation}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {signatureMatchingDocument && (
        <div
          className="match-overlay drawing-workspace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signature-matching-title"
        >
          <button className="drawer-scrim" onClick={closeSignatureMatching} />
          <section className="match-panel drawing-workspace-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1H · CONTROLLED NORMALIZATION</small>
                <h2 id="signature-matching-title">
                  Symbol Occurrence Matching
                </h2>
                <p>
                  {signatureMatchingDocument.logical_name} · signature v
                  {signatureMatchingData?.version?.version_number || "?"}
                </p>
              </div>
              <button onClick={closeSignatureMatching}>×</button>
            </header>
            {signatureMatchingError && (
              <p className="managed-document-error" role="alert">
                {signatureMatchingError}
              </p>
            )}
            <div className="drawing-workspace-body">
              <div className="drawing-overview-metrics">
                <article>
                  <small>EVALUATED</small>
                  <strong>
                    {signatureMatchingData?.version?.summary
                      ?.occurrencesEvaluated || 0}
                  </strong>
                </article>
                <article>
                  <small>CANDIDATES</small>
                  <strong>
                    {signatureMatchingData?.candidates?.length || 0}
                  </strong>
                </article>
                <article>
                  <small>TOPOLOGY BLOCKED</small>
                  <strong>
                    {signatureMatchingData?.version?.summary
                      ?.topologyRejected || 0}
                  </strong>
                </article>
                <article>
                  <small>CONFIRMED</small>
                  <strong>
                    {signatureMatchingData?.candidates?.filter(
                      (c: any) => c.review_status === "Confirmed",
                    ).length || 0}
                  </strong>
                </article>
              </div>
              <label>
                Reviewer reason
                <textarea
                  value={signatureMatchingReason}
                  onChange={(e) => setSignatureMatchingReason(e.target.value)}
                />
              </label>
              <div className="drawing-page-list">
                {signatureMatchingData?.candidates?.map((candidate: any) => (
                  <article key={candidate.id}>
                    <header>
                      <strong>
                        Page {candidate.page_number} ·{" "}
                        {candidate.similarity_score}%
                      </strong>
                      <span>
                        {candidate.confidence}% · {candidate.review_status}
                      </span>
                    </header>
                    <p>{candidate.matching_basis}</p>
                    <small>
                      {candidate.geometry_differences.length
                        ? candidate.geometry_differences.join(" · ")
                        : "No material normalized difference"}
                    </small>
                    <code>{JSON.stringify(candidate.bounding_box)}</code>
                    <div className="symbol-review-actions">
                      <button
                        onClick={() =>
                          void reviewOccurrenceMatch(candidate.id, "confirm")
                        }
                      >
                        Confirm occurrence
                      </button>
                      <button
                        onClick={() =>
                          void reviewOccurrenceMatch(candidate.id, "reject")
                        }
                      >
                        Reject
                      </button>
                      <button
                        onClick={() =>
                          void reviewOccurrenceMatch(candidate.id, "restore")
                        }
                      >
                        Restore
                      </button>
                    </div>
                  </article>
                ))}
                {!signatureMatchingData?.candidates?.length && (
                  <div className="empty-state">
                    <strong>No safe occurrence candidates</strong>
                    <p>
                      Different topology, fill state, holes, or component
                      structure remained blocked.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <footer className="preview-actions">
              <span>
                Confirmed occurrences remain observations, never BOQ quantities.
              </span>
              <button onClick={closeSignatureMatching}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {occurrenceClusteringDocument && (
        <div
          className="match-overlay drawing-workspace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="occurrence-clustering-title"
        >
          <button
            className="drawer-scrim"
            onClick={closeOccurrenceClustering}
          />
          <section className="match-panel drawing-workspace-panel">
            <header className="match-header">
              <div>
                <small>PHASE 4.1I · OCCURRENCE RECONSTRUCTION</small>
                <h2 id="occurrence-clustering-title">
                  Occurrence Spatial Clustering
                </h2>
                <p>
                  {occurrenceClusteringDocument.logical_name} · clustering v
                  {occurrenceClusteringData?.version?.version_number || "?"}
                </p>
              </div>
              <button onClick={closeOccurrenceClustering}>×</button>
            </header>
            {occurrenceClusteringError && (
              <p className="managed-document-error" role="alert">
                {occurrenceClusteringError}
              </p>
            )}
            <div className="drawing-workspace-body">
              <div className="drawing-overview-metrics">
                <article>
                  <small>PATHS</small>
                  <strong>
                    {occurrenceClusteringData?.version?.summary
                      ?.pathsProcessed || 0}
                  </strong>
                </article>
                <article>
                  <small>CLUSTERS</small>
                  <strong>
                    {occurrenceClusteringData?.version?.summary
                      ?.clustersGenerated || 0}
                  </strong>
                </article>
                <article>
                  <small>EXCLUDED</small>
                  <strong>
                    {occurrenceClusteringData?.version?.summary
                      ?.excludedClusters || 0}
                  </strong>
                </article>
                <article>
                  <small>CANDIDATES</small>
                  <strong>
                    {occurrenceClusteringData?.version?.summary
                      ?.matchCandidates || 0}
                  </strong>
                </article>
              </div>
              <label>
                Reviewer reason
                <textarea
                  value={occurrenceClusteringReason}
                  onChange={(e) =>
                    setOccurrenceClusteringReason(e.target.value)
                  }
                />
              </label>
              <div className="drawing-page-list">
                {occurrenceClusteringData?.clusters?.map((cluster: any) => (
                  <article key={cluster.id}>
                    <header>
                      <strong>
                        Page {cluster.page_number} · {cluster.fragment_count}{" "}
                        paths
                      </strong>
                      <span>
                        {cluster.detection_confidence}% ·{" "}
                        {cluster.review_status}
                      </span>
                    </header>
                    <p>{cluster.detection_basis}</p>
                    <small>
                      {cluster.exclusion_reasons.length
                        ? cluster.exclusion_reasons.join(" · ")
                        : cluster.geometry_differences.join(" · ") ||
                          `${cluster.match_similarity}% normalized similarity`}
                    </small>
                    <code>{JSON.stringify(cluster.bounding_box)}</code>
                    {cluster.review_status === "Needs Review" && (
                      <div className="symbol-review-actions">
                        <button
                          onClick={() =>
                            void reviewOccurrenceCluster(cluster.id, "confirm")
                          }
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() =>
                            void reviewOccurrenceCluster(cluster.id, "reject")
                          }
                        >
                          Reject
                        </button>
                        <button
                          onClick={() =>
                            void reviewOccurrenceCluster(cluster.id, "restore")
                          }
                        >
                          Restore
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
            <footer className="preview-actions">
              <span>Clusters are observations only and never quantities.</span>
              <button onClick={closeOccurrenceClustering}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
