"use client";

// Agent 8 -- engineer-decision technical view, BOM/accessory summary and the
// standardized evidence drawer.
//
// This file is deliberately price-blind. The commercial block in
// EngineerDecisionWorkspace is owned by another lane and is left untouched;
// the components below add a technical-only reading of the same governed
// records.

import { count } from "../../domain/engineer-decision-presentation.mjs";

export type EvidenceDrawerModel = {
  tiers: Array<{ id: string; label: string; kind: string; value: RationaleTier | CountsTier | DocumentTier | AdvancedTier }>;
  headline: string;
  hasRawRecord: boolean;
  identifierCountLabel: string;
};
type RationaleTier = string;
type CountsTier = { sourceLabels: string[]; sourceCountLabel: string; warningCountLabel: string; warningSummaries: string[] };
type DocumentTier = { document: string; page: string; sheet: string | null; clause: string | null };
type AdvancedTier = { identifiers: Array<{ key: string; value: string }>; raw: string | null };

export type DecisionPrimaryAction = {
  kind: string;
  workspace: string;
  label: string;
  blockCode: string | null;
  resolutionAction: string | null;
  owner: string | null;
};

export type EngineerDecisionTechnicalModel =
  | { available: false; reason: string }
  | {
      available: true;
      itemReference: string | null;
      description: string | null;
      compositeState: string | null;
      selectedProduct: { partNumber: string | null; manufacturer: string | null; family: string | null; approved: boolean; label: string } | null;
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
      openIssues: Array<{ kind: string; code: string | null; detail: string; owner: string | null; resolutionAction: string | null }>;
      alternatives: Array<{ candidateId: string; partNumber: string | null; manufacturer: string | null; technicalStatus: string; confidence: string; viable: boolean; fallback: boolean }>;
      primaryAction: DecisionPrimaryAction | null;
    };

export type BomAccessorySummaryModel = {
  available: false;
  reason: string;
  totals: null;
  byRole: never[];
  unresolved: never[];
  link: null;
} | {
  available: true;
  totals: { components: number; componentsLabel: string; unresolved: number; unresolvedLabel: string; missingQuantity: number; missingQuantityLabel: string };
  byRole: Array<{ role: string; label: string; count: number; countLabel: string }>;
  unresolved: Array<{ role: string; roleLabel: string; partNumber: string | null; relationshipType: string | null }>;
  primaryQuantity: { value: number | null; label: string; origin: string } | null;
  readiness: { state: string; label: string };
  link: { workspace: string; label: string };
};

export function EvidenceDrawer({ drawer, title = "Evidence" }: { drawer: EvidenceDrawerModel; title?: string }) {
  if (!drawer) return null;
  const rationale = drawer.tiers[0].value as RationaleTier;
  const counts = drawer.tiers[1].value as CountsTier;
  const document = drawer.tiers[2].value as DocumentTier;
  const advanced = drawer.tiers[3].value as AdvancedTier;
  return <details className="evidence-drawer">
    <summary>{title}</summary>
    <section className="evidence-tier" data-tier="rationale">
      <small>{drawer.tiers[0].label}</small>
      <p>{drawer.headline || rationale}</p>
    </section>
    <section className="evidence-tier" data-tier="counts">
      <small>{drawer.tiers[1].label}</small>
      <p>{counts.sourceCountLabel} source(s) · {counts.warningCountLabel} warning(s)</p>
      {counts.sourceLabels.length > 0 && <ul>{counts.sourceLabels.map((label) => <li key={label}>{label}</li>)}</ul>}
      {counts.warningSummaries.length > 0 && <ul>{counts.warningSummaries.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </section>
    <section className="evidence-tier" data-tier="document">
      <small>{drawer.tiers[2].label}</small>
      <p>{document.document} · {document.page}{document.clause ? ` · clause ${document.clause}` : ""}</p>
    </section>
    <section className="evidence-tier" data-tier="advanced">
      <small>{drawer.tiers[3].label}</small>
      <p>{drawer.identifierCountLabel} identifier(s) recorded</p>
      {advanced.identifiers.length > 0 && <ul>{advanced.identifiers.map((entry) => <li key={entry.key}><code>{entry.key}</code> {entry.value}</li>)}</ul>}
      {drawer.hasRawRecord && <pre className="evidence-raw">{advanced.raw}</pre>}
    </section>
  </details>;
}

export function EngineerDecisionTechnicalView({ model, onPrimaryAction, drawer }: { model: EngineerDecisionTechnicalModel; onPrimaryAction: (action: DecisionPrimaryAction) => void; drawer?: EvidenceDrawerModel }) {
  if (!model?.available) return <section className="engineer-decision-technical"><p>{"reason" in model ? model.reason : "Technical decision record unavailable."}</p></section>;
  if (!model) return <section className="engineer-decision-technical"><p>Technical decision record unavailable.</p></section>;

  return <section className="engineer-decision-technical">
    <header>
      <small>TECHNICAL DECISION · {model.itemReference || "No reference"}</small>
      <h2>{model.description || "BOQ item"}</h2>
    </header>

    <section className="technical-selected-product">
      <small>SELECTED PRODUCT</small>
      {model.selectedProduct
        ? <><strong>{model.selectedProduct.label}</strong>
          <span>{model.selectedProduct.family || "Family not recorded"}</span>
          <span className={model.selectedProduct.approved ? "decision-axis-ready" : "decision-axis-unknown"}>{model.selectedProduct.approved ? "Approved for this decision" : "Not approved for this decision"}</span></>
        : <strong>No product selected</strong>}
    </section>

    <section className="technical-why">
      <small>WHY</small>
      {model.why.length > 0
        ? model.why.map((entry) => <div key={entry.label}><strong>{entry.label}</strong><p>{entry.detail}</p></div>)
        : <p>No classification or safety rationale recorded.</p>}
    </section>

    <section className="technical-evidence">
      <small>EVIDENCE</small>
      <p>{model.evidence.applicableRequirementsLabel} applicable requirement(s) · {model.evidence.openClarificationsLabel} open clarification(s)</p>
      <p>Technical safety: {model.evidence.safetyState} · Compliance: {model.evidence.complianceState} · Recalculation: {model.evidence.recalculationStatus}</p>
      {drawer && <EvidenceDrawer drawer={drawer} title="Evidence detail" />}
    </section>

    <section className="technical-open-issues">
      <small>OPEN ISSUES ({count(model.openIssues.length)})</small>
      {model.openIssues.length > 0
        ? <ul>{model.openIssues.map((issue, index) => <li key={`${issue.kind}-${index}`}><b>{issue.code || issue.kind}</b> — {issue.detail}{issue.owner ? ` · Owner: ${issue.owner}` : ""}</li>)}</ul>
        : <p>No open technical issue recorded.</p>}
    </section>

    <section className="technical-alternatives">
      <small>ALTERNATIVES ({count(model.alternatives.length)})</small>
      {model.alternatives.length > 0
        ? <ul>{model.alternatives.map((alternative) => <li key={alternative.candidateId}>{alternative.manufacturer || "Manufacturer not recorded"} · {alternative.partNumber || "Part number not recorded"} — {alternative.technicalStatus} ({alternative.confidence}){alternative.fallback ? " · fallback" : ""}</li>)}</ul>
        : <p>No alternative candidate recorded.</p>}
    </section>

    {model.primaryAction
      ? <div className="preview-actions"><button type="button" onClick={() => onPrimaryAction(model.primaryAction as DecisionPrimaryAction)}>{model.primaryAction.label}</button></div>
      : <p className="audit-note">No primary action is currently available for this item.</p>}
  </section>;
}

export function BomAccessorySummary({ summary, onOpenBom }: { summary: BomAccessorySummaryModel; onOpenBom: (workspace: string) => void }) {
  if (!summary || !summary.available) return <section className="bom-summary"><small>ACCESSORIES</small><p>{"reason" in summary ? summary.reason : "No bill of materials record loaded."}</p></section>;

  return <section className="bom-summary">
    <small>ACCESSORIES</small>
    <p>{summary.totals.componentsLabel} component(s) · {summary.totals.unresolvedLabel} awaiting decision · {summary.totals.missingQuantityLabel} without a recorded quantity</p>
    <ul>{summary.byRole.map((entry) => <li key={entry.role}>{entry.label}: {entry.countLabel}</li>)}</ul>
    {summary.primaryQuantity && <p>Primary quantity: {summary.primaryQuantity.label} ({summary.primaryQuantity.origin})</p>}
    {summary.unresolved.length > 0 && <ul>{summary.unresolved.map((entry, index) => <li key={`${entry.role}-${index}`}>Unresolved {entry.roleLabel}: {entry.partNumber || "Part number missing"}</li>)}</ul>}
    <button type="button" className="secondary-action" onClick={() => onOpenBom(summary.link.workspace)}>{summary.link.label}</button>
  </section>;
}
