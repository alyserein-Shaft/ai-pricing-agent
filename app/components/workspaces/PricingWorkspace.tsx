import type { PriceSourceView, PricingLineView, PricingScenarioView } from "./commercial-types";
import { pricingSourcePresentation } from "./commercial-models.mjs";
import { EmptyState, ErrorState, LoadingState, PrerequisiteState } from "../shared/WorkspaceStates";

export function PricingWorkspace(props: { currency: string; scenarios: PricingScenarioView[]; scenarioId: string; lines: PricingLineView[]; sources: Record<string, PriceSourceView[]>; loading: boolean; error: string; available: boolean; blocker?: string; onPrerequisite: () => void; onScenario: (id: string) => void; onCreateScenario: () => void; onCalculate: (itemId: string, sourceId?: string) => void; onSubmitManualPrice: (itemId: string) => void; onReviewSource: (itemId: string, sourceId: string) => void; onOpenReview: () => void; money: (value: number) => string }) {
  const calculated = props.lines.filter(line => line.status !== "Not Started");
  const eligible = calculated.filter(line => line.result?.approvalReady === true);
  const draft = eligible.reduce((sum, line) => sum + Number(line.result?.finalValue || 0), 0);
  return <section className="module-page server-pricing-workspace">
    <div className="module-heading"><div><small>STEP 06 · COSTING &amp; PRICING</small><h1>Costing &amp; Pricing</h1><p>Every value below is read from a persisted pricing run. Historical sources remain discovery-only.</p></div>{props.available&&<button onClick={props.onOpenReview}>Open commercial review</button>}</div>
    {!props.available ? <PrerequisiteState state="WAITING" statusLabel="Waiting for technical review" title="Pricing is not available yet" detail={props.blocker || "Pricing starts after a technically eligible product is approved."} action="Open technical review" onAction={props.onPrerequisite}/> : <>
    <section className="persistent-pricing-control"><div><strong>Pricing scenario</strong><p>Scenario selection is presentation state; calculations and source selection are validated by the server.</p></div><div><select aria-label="Pricing scenario" value={props.scenarioId} onChange={event => props.onScenario(event.target.value)}><option value="">Select scenario…</option>{props.scenarios.map(s => <option key={s.id} value={s.id}>{s.name} · v{s.version_number} · {s.project_currency}</option>)}</select><button onClick={props.onCreateScenario}>＋ Create scenario</button></div></section>
    {props.error && <ErrorState message={props.error}/>} {props.loading && <LoadingState label="Loading current pricing records…"/>}
    <div className="pricing-header">
      <div className="pricing-header-left">
        <small>PRICE</small>
        <strong>{props.currency} {props.money(draft)}</strong>
      </div>
      <div className="pricing-header-center">
        <small>PRODUCT</small>
        <strong>{props.lines.length} records</strong>
      </div>
      <div className="pricing-header-right">
        <small>VALIDITY</small>
        <span>{props.blocker || "—"}</span>
      </div>
    </div>
    <p className="review-server-note">Approval-ready means eligible for review, not commercially approved.</p>
    {!props.lines.length && !props.loading ? <EmptyState title="No persisted BOQ pricing lines" detail="Complete Product Selection before pricing."/> : <div className="persistent-review-list">{props.lines.map(line => { const source = pricingSourcePresentation(line.selectedSource); const sources = props.sources[line.itemId] || []; return <article key={line.itemId}><header><div><small>{line.itemNumber || line.itemId}</small><strong>{line.description}</strong></div><span className={line.result?.approvalReady ? "review-pending" : "review-blocked"}>{line.status}</span></header><dl><div><dt>Price source</dt><dd>{source.label}</dd></div><div><dt>Version</dt><dd>{line.version || "Not calculated"}</dd></div><div><dt>Total cost</dt><dd>{props.currency} {props.money(Number(line.result?.totalCost || 0))}</dd></div><div><dt>Draft net selling</dt><dd>{props.currency} {props.money(Number(line.result?.netSelling || 0))}</dd></div><div><dt>Margin / markup</dt><dd>{Number(line.result?.margin || 0).toFixed(2)}% / {Number(line.result?.markup || 0).toFixed(2)}%</dd></div></dl>{line.result?.engineerSuggestion?.requiresExplicitSelection ? <section className="pricing-source-read-model engineer-price-suggestion" aria-label={`Engineer Price Suggestion for ${line.description}`}><strong>Engineer suggested price</strong><div><span><b>{line.result.engineerSuggestion.currency} {props.money(line.result.engineerSuggestion.unitPrice)}</b> · {line.result.engineerSuggestion.sourceType}<small>{line.result.engineerSuggestion.reference} · {line.result.engineerSuggestion.validity}</small><small>Not selected or commercially approved</small></span><span><span className="review-pending">Explicit source selection required</span><button disabled={props.loading} onClick={() => props.onCalculate(line.itemId, line.result!.engineerSuggestion!.sourceId)}>Select suggested source and calculate</button></span></div></section> : null}<section className="pricing-source-read-model" aria-label={`Server price sources for ${line.description}`}><strong>Persisted price evidence</strong>{sources.length ? sources.map(entry => <div key={entry.id}><span>
        <b>{entry.currency} {props.money(entry.amount)}</b> 
        {entry.supplier ? `· ${entry.supplier}` : ''}
        <small>V:{entry.validityState}{entry.validUntil ? `→${entry.validUntil}` : ''}</small>
        <small>Use:{entry.downstreamUse} R:{entry.approvalStatus}</small>
      </span>{entry.approvalStatus === "Needs Review" ? <button disabled={props.loading} onClick={() => props.onReviewSource(line.itemId, entry.sourceId)}>Review price evidence</button> : <span className={entry.eligibleForCosting ? "review-ready" : "review-blocked"}>{entry.eligibleForCosting ? "Can be used in costing" : "Cannot be used in costing"}</span>}</div>) : <p>No server-persisted price evidence for the approved product.</p>}</section>{line.result?.blockers?.length ? <p className="managed-document-error">{line.result.blockers.join(" · ")}</p> : null}<footer><small>{line.result?.approvalReady ? "Technically eligible for commercial review — not approved" : "Pricing blocked or incomplete"}</small><div><button className="secondary-action" disabled={!props.scenarioId || props.loading} onClick={() => props.onSubmitManualPrice(line.itemId)}>Add manual price evidence</button><button disabled={!props.scenarioId || props.loading} onClick={() => props.onCalculate(line.itemId)}>{line.version ? "Recalculate price" : "Calculate price"}</button></div></footer></article>; })}</div>}</>}
  </section>;
}
