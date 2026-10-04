"use client";

// Agent 8 -- staged matching decision components.
//
// These consume the governed backend payload through
// app/domain/matching-decision-presentation.mjs only. No brand, product,
// price or confidence value is hard-coded here, and no UNKNOWN value is
// rendered as 0.

import {
  MATCHING_DIMENSION_LABELS,
} from "../../domain/matching-decision-presentation.mjs";

export type MatchingDimension = {
  state: "EVIDENCED" | "NOT_EVIDENCED" | "BLOCKED" | "CONFLICT";
  tone: string;
  label: string;
  detail: string;
};

export type MatchingDimensionPanel = {
  candidateId: string | null;
  partNumber: string | null;
  manufacturer: string | null;
  dimensions: Record<string, MatchingDimension>;
  blockedDimensions: string[];
  approvalBlocked: boolean;
  unknownDimensions: string[];
};

export type MatchingCandidate = {
  id: string;
  rank?: number | null;
  manufacturer?: string | null;
  part_number?: string | null;
  partNumber?: string | null;
  family?: string | null;
  rankingReason?: string | null;
  isFallbackCandidate?: boolean;
};

export type StagedCandidate = {
  candidate: MatchingCandidate;
  panel: MatchingDimensionPanel;
  fallbackPromoted?: boolean;
};

export type MatchingNextActionModel = {
  kind: string;
  label: string;
  detail: string;
  workspace: string;
  action: string;
};

const DIMENSION_LABELS: Record<string, string> = MATCHING_DIMENSION_LABELS;

const partNumberOf = (candidate: MatchingCandidate) => candidate.part_number ?? candidate.partNumber ?? "Part number not recorded";

const axis = (dimension: MatchingDimension, label: string) => (
  <div className={`decision-axis ${dimension.tone}`} key={label}>
    <span className="decision-axis-label">{label}</span>
    <span className="decision-axis-state">{dimension.label}</span>
    <small>{dimension.detail}</small>
  </div>
);

export function DecisionDimensionPanel({ panel, heading = "Assessment" }: { panel: MatchingDimensionPanel; heading?: string }) {
  if (!panel) return null;
  return <section className="decision-dimensions">
    <header><strong>{heading}</strong>{panel.approvalBlocked
      ? <span className="decision-axis-blocked">{panel.blockedDimensions.length} blocking item(s)</span>
      : <span className="decision-axis-ready">No blocking axis</span>}</header>
    {Object.entries(panel.dimensions).map(([key, dimension]) => axis(dimension, DIMENSION_LABELS[key] || key))}
    {panel.unknownDimensions.length > 0 && <p className="decision-unknown-note">Not evidenced: {panel.unknownDimensions.map((key) => DIMENSION_LABELS[key] || key).join(", ")}. These are gaps in the record, not passes.</p>}
  </section>;
}

export function RecommendedCandidateHero({ entry, onSelect }: { entry: StagedCandidate; onSelect: (candidateId: string) => void }) {
  if (!entry?.candidate) return null;
  const { candidate, panel, fallbackPromoted } = entry;
  return <article className="candidate-hero">
    <header>
      <div>
        <small>RECOMMENDED CANDIDATE · RANK {candidate.rank ?? "—"}</small>
        <h3>{candidate.manufacturer || "Manufacturer not recorded"} · {partNumberOf(candidate)}</h3>
        <p>{candidate.family || "Family not recorded"}</p>
      </div>
      {panel.approvalBlocked
        ? <span className="decision-axis-blocked">Blocked — not selectable</span>
        : <span className="decision-axis-ready">Open for engineer review</span>}
    </header>
    {fallbackPromoted && <p className="decision-fallback-note" role="note">This is a fallback candidate. No primary candidate exists on the current run.</p>}
    {candidate.rankingReason && <div className="evidence"><span>Why it leads</span><p>{candidate.rankingReason}</p></div>}
    <DecisionDimensionPanel panel={panel} heading="Separated assessment" />
    <p className="audit-note">A recommendation is not an approval. Selecting a product starts engineer review; it does not approve compliance, price or a quotation.</p>
    <button type="button" disabled={panel.approvalBlocked} onClick={() => onSelect(candidate.id)}>Select Product for engineer review</button>
  </article>;
}

export function AlternativesList({ alternatives, onSelect }: { alternatives: StagedCandidate[]; onSelect: (candidateId: string) => void }) {
  if (!alternatives?.length) return null;
  return <section className="candidate-alternatives">
    <header><strong>Alternatives</strong><small>{alternatives.length} further candidate(s) from the same governed run. Nothing here outranks the recommended candidate.</small></header>
    {alternatives.map(({ candidate, panel }) => <article key={candidate.id} className="candidate-card">
      <header>
        <div><small>RANK {candidate.rank ?? "—"}</small><strong>{candidate.manufacturer || "Manufacturer not recorded"} · {partNumberOf(candidate)}</strong></div>
        {candidate.isFallbackCandidate && <span className="fallback-candidate-badge">Fallback candidate</span>}
      </header>
      <DecisionDimensionPanel panel={panel} heading="Separated assessment" />
      <button type="button" disabled={panel.approvalBlocked} onClick={() => onSelect(candidate.id)}>Select for engineer review</button>
    </article>)}
  </section>;
}

export function MatchingNextAction({ nextAction, onNavigate }: { nextAction: MatchingNextActionModel; onNavigate: (workspace: string, action: string) => void }) {
  if (!nextAction) return null;
  return <aside className={`matching-next-action ${nextAction.kind === "READY" ? "is-ready" : "is-blocked"}`} role="status">
    <small>NEXT ACTION · {nextAction.kind}</small>
    <strong>{nextAction.label}</strong>
    <p>{nextAction.detail}</p>
    <button type="button" onClick={() => onNavigate(nextAction.workspace, nextAction.action)}>{nextAction.label}</button>
  </aside>;
}
