"use client";

import { TechnicalRequirementsWorkspace } from "./TechnicalRequirementsWorkspace";
import { EmptyState } from "../shared/WorkspaceStates";

type WorkspaceProps = React.ComponentProps<typeof TechnicalRequirementsWorkspace>;
type BranchProps = Pick<WorkspaceProps, "documentName" | "reviewerName" | "reviewerEmail"> & {
  requirementReviewDocument: { id: string; logical_name: string } | null;
  authSession: { user: { displayName: string; email: string } } | null;
  managedDocuments: Array<{ id: string; logical_name: string; document_type?: string }>;
  onOpenReview: (document: { id: string; logical_name: string }) => void;
} & Omit<WorkspaceProps, "documentName" | "reviewerName" | "reviewerEmail">;

// Requirements as a real project surface (not modal-only). With a document in
// context it renders the governed review workspace inline; otherwise it offers
// the project's specification documents to open. Document picking reuses the
// existing openTechnicalRequirementReview flow, so no review logic is forked.
export function RequirementsModuleBranch(props: BranchProps) {
  const { requirementReviewDocument, authSession, managedDocuments, onOpenReview, ...rest } = props as BranchProps & { managedDocuments: BranchProps["managedDocuments"]; onOpenReview: BranchProps["onOpenReview"] };
  // Map page prop names (technicalRequirements, filteredTechnicalRequirements, etc.)
  // to component prop names (requirements, filtered, etc.)
  const {
    technicalRequirements,
    filteredTechnicalRequirements,
    selectedTechnicalRequirement,
    technicalRequirementHistory,
    technicalRequirementsLoading,
    technicalRequirementError,
    technicalRequirementSearch,
    technicalRequirementSection,
    technicalRequirementClause,
    technicalRequirementPage,
    technicalRequirementStatus,
    technicalRequirementSections,
    technicalRequirementClauses,
    technicalRequirementPages,
    ...otherRest
  } = rest;
  const componentProps = {
    ...otherRest,
    requirements: technicalRequirements,
    filtered: filteredTechnicalRequirements,
    selected: selectedTechnicalRequirement,
    history: technicalRequirementHistory,
    loading: technicalRequirementsLoading,
    error: technicalRequirementError,
    search: technicalRequirementSearch,
    section: technicalRequirementSection,
    clause: technicalRequirementClause,
    page: technicalRequirementPage,
    status: technicalRequirementStatus,
    sections: technicalRequirementSections,
    clauses: technicalRequirementClauses,
    pages: technicalRequirementPages,
  };
  if (requirementReviewDocument && authSession) {
    return <section className="module-page requirement-module-page">
      <div className="module-heading"><div><small>TENDER · REQUIREMENTS</small><h1>Requirements</h1><p>Needs review first, then approved, with conflicts and evidence one step away.</p></div></div>
      <TechnicalRequirementsWorkspace {...componentProps} documentName={requirementReviewDocument.logical_name} reviewerName={authSession.user.displayName} reviewerEmail={authSession.user.email} />
    </section>;
  }
  const specs = (managedDocuments || []).filter((doc) => /spec/i.test(doc.document_type || "") || /spec/i.test(doc.logical_name || ""));
  const choices = specs.length ? specs : managedDocuments || [];
  return <section className="module-page requirement-module-page">
    <div className="module-heading"><div><small>TENDER · REQUIREMENTS</small><h1>Requirements</h1><p>Open a specification document to review its extracted requirements with source evidence.</p></div></div>
    {!choices.length && <EmptyState title="No documents yet" detail="Upload the specification in Documents first." />}
    {choices.map((doc) => <article key={doc.id}>
      <strong>{doc.logical_name}</strong>
      <button onClick={() => onOpenReview(doc)}>Open review →</button>
    </article>)}
  </section>;
}
