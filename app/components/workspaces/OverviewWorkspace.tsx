import type { EstimatorReadiness, PreSalesWorkflow, ServerProjectDashboard } from "../project/types";
import { EmptyState } from "../shared/WorkspaceStates";

export function OverviewWorkspace({ dashboard, workflow, estimatorReadiness, onOpenRoute, money }: {
  dashboard: ServerProjectDashboard; workflow: PreSalesWorkflow;
  estimatorReadiness: EstimatorReadiness | null;
  onOpenRoute: (route: string) => void; money: (value: number) => string;
}) {
  return <section className="module-page operational-project-dashboard">
    <div className="module-heading"><div><small>PROJECT OPERATIONS · SERVER VERIFIED</small><h1>{dashboard.project.name}</h1>
      <p>{dashboard.project.client || "Client not recorded"} · {dashboard.project.tenderNumber || dashboard.project.id} · Updated {new Date(dashboard.updatedAt).toLocaleString()}</p></div>
      <span className={dashboard.workflow.ready ? "review-ready" : "review-pending"}>{dashboard.project.status}</span></div>
    <div className="summary-grid">
      <article><span>Documents</span><strong>{dashboard.facts.documents || 0}</strong><small>{dashboard.facts.processing || 0} processing · {dashboard.facts.failedJobs || 0} failed</small></article>
      <article><span>BOQ items</span><strong>{dashboard.facts.boqItems || 0}</strong><small>{dashboard.facts.matchedItems || 0} matched · {dashboard.facts.technicalApproved || 0} technically approved</small></article>
      <article><span>Workflow progress</span><strong>{workflow.progress}%</strong><small>Model {workflow.modelVersion} · verified stages</small></article>
      <article><span>{dashboard.commercialRestricted ? "Commercial data" : "Quoted value"}</span><strong>{dashboard.commercialRestricted ? "Restricted" : `${dashboard.totals?.currency || "SAR"} ${money(dashboard.totals?.quotedValue || 0)}`}</strong><small>{dashboard.commercialRestricted ? "Requires commercial permission" : `${(dashboard.totals?.averageMargin || 0).toFixed(1)}% average margin`}</small></article>
    </div>
    {estimatorReadiness && <section className="estimation-progress" aria-label="Estimation progress">
      <div className="section-title"><div><small>ESTIMATION PROGRESS · SERVER DERIVED</small><strong>{estimatorReadiness.summary.total} BOQ Items</strong></div><button onClick={() => onOpenRoute("BOQ")}>Review Estimation →</button></div>
      <div className="summary-grid">
        <article><span>Ready</span><strong>{estimatorReadiness.summary.ready}</strong><small>Product and current price usable</small></article>
        <article><span>Review</span><strong>{estimatorReadiness.summary.review}</strong><small>Engineer confirmation required</small></article>
        <article><span>Missing</span><strong>{estimatorReadiness.summary.missing}</strong><small>Essential evidence absent</small></article>
        <article><span>Excluded</span><strong>{estimatorReadiness.summary.excluded}</strong><small>Outside quotation coverage</small></article>
      </div>
      <div className="estimation-coverage"><span>AI Coverage <strong>{estimatorReadiness.summary.aiCoverage}%</strong></span><span>Quotation Coverage <strong>{estimatorReadiness.summary.quotationCoverage}%</strong></span></div>
    </section>}
    {workflow.nextAction ? <button className="next-recommended-action" onClick={() => onOpenRoute(workflow.nextAction!.route)}><span><small>NEXT WORKFLOW ACTION · {workflow.nextAction.owner}</small><strong>{workflow.nextAction.title}</strong><p>{workflow.blockers.find(b => b.stageId === workflow.currentStageId)?.message || "Continue the governed pre-sales workflow."}</p></span><b>Open work →</b></button> : <EmptyState title="No action currently requires attention" detail="The current quotation has completed the governed workflow."/>}
    <section className="workflow-stage-board" aria-label="Complete AI pre-sales estimation workflow">{workflow.stages.map(stage => <button key={stage.id} onClick={() => onOpenRoute(stage.route)} className={`workflow-stage-card stage-${stage.status.toLowerCase().replaceAll(" ", "-")}`}><header><strong>{stage.name}</strong><span>{stage.status}</span></header><div><i style={{width:`${stage.progress}%`}}/></div><p>{stage.progress}% · {stage.owner}</p>{stage.blockers.length > 0 && <small>{stage.blockers[0]}</small>}</button>)}</section>
    <div className="action-health-grid"><section className="action-queue"><div className="section-title"><div><small>SERVER ACTION QUEUE</small><strong>Actionable work only</strong></div><span>{dashboard.actions.length} open</span></div>{dashboard.actions.map(action => <button key={action.id} className="action-row" onClick={() => onOpenRoute(action.route)}><span className={`action-priority ${action.severity === "Critical" ? "p0" : "p1"}`}>{action.severity}</span><span><strong>{action.title}</strong><small>{action.description} · Owner: {action.owner}</small></span><b>Resolve →</b></button>)}</section>
      <aside className="project-risk-panel"><small>EXPLAINED RISKS</small><h2>{dashboard.risks.length ? `${dashboard.risks.length} active` : "No active risk"}</h2>{dashboard.risks.map(risk => <button key={risk.id} onClick={() => onOpenRoute(risk.recommendedAction)}><span className={`risk-level risk-${risk.severity.toLowerCase()}`}>{risk.severity}</span><strong>{risk.type}</strong><p>{risk.trigger}</p><small>{risk.impact}</small></button>)}</aside></div>
  </section>;
}
