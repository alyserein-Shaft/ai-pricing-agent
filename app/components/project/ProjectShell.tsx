import type { PreSalesWorkflow, ServerProjectDashboard } from "./types";
import { canonicalStepperItems } from "../../lib/project-navigation.mjs";

export function ProjectShell(props: {
  dashboard: ServerProjectDashboard | null;
  workflow: PreSalesWorkflow | null;
  projectCode: string;
  workspaceSeal: string;
  activeWorkspace: string;
  canViewCommercial: boolean;
  onNavigate: (workspace: string) => void;
  onOpenRoute: (route: string) => void;
}) {
  const { dashboard, workflow } = props;
  return <>
    <nav className="project-workflow-tabs" aria-label="Project estimation workflow">
      {canonicalStepperItems(workflow).map((item, index) => {
        const label = item.name;
        const workspace = item.workspace;
        const locked = !props.canViewCommercial && ["Costing", "Quotation"].includes(workspace);
        return <button key={item.id} disabled={locked} title={locked ? "Commercial permission required" : undefined}
          className={props.activeWorkspace === workspace ? "active" : ""}
          onClick={() => item.route ? props.onOpenRoute(item.route) : props.onNavigate(workspace)}>
          <span>{index + 1}</span><strong>{label}</strong><small>{locked ? "Locked" : item.status}</small>
        </button>;
      })}
    </nav>
    <div className="workspace-context-seal" aria-label={`Active project ${props.projectCode}`}>
      <span>PROJECT WORKSPACE</span><strong>{props.projectCode}</strong>
      <small>{props.activeWorkspace} · {dashboard?.facts.boqItems || 0} BOQ item{dashboard?.facts.boqItems === 1 ? "" : "s"}</small>
    </div>
    <section className="project-strip" aria-label="Project status">
      <div><span className="status-dot"/><strong>{dashboard?.project.status || "Loading status…"}</strong>
        <small>{workflow ? `${workflow.progress}% workflow progress · ${workflow.blockers.length} blocker(s)` : "Reading verified project records"}</small></div>
      <div className="strip-progress"><span style={{ width: `${workflow?.progress || 0}%` }}/></div>
      <button disabled={!workflow?.nextAction} onClick={() => workflow?.nextAction && props.onOpenRoute(workflow.nextAction.route)}>
        {workflow?.nextAction?.title || "No action required"} →
      </button>
    </section>
  </>;
}
