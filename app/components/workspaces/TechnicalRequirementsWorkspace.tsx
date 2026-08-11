import type { RequirementHistoryView, TechnicalRequirementView } from "./technical-matching-types";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

export function TechnicalRequirementsWorkspace(props: {
  documentName: string; reviewerName: string; reviewerEmail: string;
  requirements: TechnicalRequirementView[]; filtered: TechnicalRequirementView[];
  selected: TechnicalRequirementView | null; history: RequirementHistoryView[];
  loading: boolean; error: string; search: string; section: string; clause: string;
  page: string; status: string; sections: string[]; clauses: string[]; pages: number[];
  onSearch: (value: string) => void; onSection: (value: string) => void;
  onClause: (value: string) => void; onPage: (value: string) => void;
  onStatus: (value: string) => void; onSelect: (row: TechnicalRequirementView) => void;
  onDecision: (row: TechnicalRequirementView, operation: "update" | "approve" | "reject" | "restore") => void;
  onClose: () => void;
}) {
  return <div className="match-overlay requirement-review-overlay" role="dialog" aria-modal="true" aria-labelledby="requirement-review-title">
    <button className="drawer-scrim" onClick={props.onClose} aria-label="Close technical requirement review"/>
    <section className="match-panel requirement-review-panel">
      <header className="match-header"><div><small>GOVERNED SPECIFICATION REVIEW</small><h2 id="requirement-review-title">Technical Requirement Review</h2><p>{props.documentName} · {props.requirements.length} extracted requirements · reviewer {props.reviewerName}</p></div><button onClick={props.onClose} aria-label="Close technical requirement review">×</button></header>
      <div className="requirement-review-filters">
        <label>Search<input aria-label="Search requirements" value={props.search} onChange={event => props.onSearch(event.target.value)} placeholder="Evidence, requirement or technical term"/></label>
        <label>Section<select value={props.section} onChange={event => props.onSection(event.target.value)}><option>All</option>{props.sections.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Clause<select value={props.clause} onChange={event => props.onClause(event.target.value)}><option>All</option>{props.clauses.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Page<select value={props.page} onChange={event => props.onPage(event.target.value)}><option>All</option>{props.pages.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Status<select value={props.status} onChange={event => props.onStatus(event.target.value)}><option>All</option><option>Needs Review</option><option>Approved</option><option>Rejected</option></select></label>
      </div>
      {props.error && <ErrorState message={props.error}/>} {props.loading && <LoadingState label="Loading persisted requirements…"/>}
      {!props.loading && <div className="requirement-review-layout"><section className="requirement-review-list"><header><strong>{props.filtered.length} matching requirements</strong></header>{props.filtered.map(row => <button key={row.id} className={props.selected?.id === row.id ? "selected" : ""} onClick={() => props.onSelect(row)}><span><strong>#{row.sequence} · {row.requirement_category}</strong><small>{row.normalized_requirement}</small></span><b className={row.review_status === "Approved" ? "review-ready" : "review-pending"}>{row.review_status}</b></button>)}{!props.filtered.length && <EmptyState title="No requirements match these filters"/>}</section>
        <section className="requirement-review-detail">{props.selected ? <><header><div><small>REQUIREMENT #{props.selected.sequence}</small><h3>{props.selected.requirement_category}</h3></div><span className={props.selected.review_status === "Approved" ? "review-ready" : "review-pending"}>{props.selected.review_status}</span></header>
          <dl><div><dt>Section</dt><dd>{props.selected.source_location.section || "Not recorded"}</dd></div><div><dt>Clause</dt><dd>{props.selected.source_location.clause || "Not recorded"}</dd></div><div><dt>Page</dt><dd>{props.selected.source_location.pageFrom || "Not recorded"}</dd></div><div><dt>Confidence</dt><dd>{props.selected.confidence}% · {props.selected.confidence_state}</dd></div></dl>
          <section className="requirement-evidence"><strong>Original evidence</strong><p>{props.selected.original_text}</p><small>{props.selected.source_location.clausePath?.join(" → ")}</small></section>
          <section className="requirement-values"><strong>Normalized requirement</strong><p>{props.selected.normalized_requirement}</p><pre>{JSON.stringify(props.selected.current_values || {}, null, 2)}</pre></section>
          <div className="preview-actions"><button onClick={() => props.onDecision(props.selected!, "update")}>Edit</button><button onClick={() => props.onDecision(props.selected!, "approve")}>Approve Technical Interpretation</button><button onClick={() => props.onDecision(props.selected!, "reject")}>Reject</button><button onClick={() => props.onDecision(props.selected!, "restore")}>Restore</button></div>
          <section className="requirement-audit-history"><header><strong>Immutable review history</strong><small>{props.history.length} decisions</small></header>{props.history.map(entry => <article key={entry.id}><strong>{entry.action}</strong><p>{entry.reason}</p><small>{entry.decided_by} · {new Date(entry.decided_at).toLocaleString()}</small></article>)}{!props.history.length && <p>No review decision has been recorded.</p>}</section>
        </> : <EmptyState title="Select a requirement" detail="Inspect original evidence and provenance before recording a decision."/>}</section></div>}
      <footer className="preview-actions"><span>{props.reviewerName} · {props.reviewerEmail} · decisions require a reason</span><button onClick={props.onClose}>Close review</button></footer>
    </section>
  </div>;
}
