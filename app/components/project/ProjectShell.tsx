import type { PreSalesWorkflow, ServerProjectDashboard } from "./types";
import { workflowPresentation } from "../../lib/project-navigation.mjs";

type Tab = readonly [string, string];
export function ProjectShell(props: {
  dashboard: ServerProjectDashboard | null;
  workflow: PreSalesWorkflow | null;
  projectCode: string;
  workspaceSeal: string;
  activeWorkspace: string;
  tabs: readonly Tab[];
  canViewCommercial: boolean;
  onNavigate: (workspace: string) => void;
  onOpenRoute: (route: string) => void;
}) {
  const { dashboard, workflow } = props;
  return <>
    <nav className="project-workflow-tabs" aria-label="Project estimation workflow">
      {props.tabs.map(([label, workspace], index) => {
        const locked = !props.canViewCommercial && ["Costing", "Quotation"].includes(workspace);
        const stage = workflowPresentation(workflow, workspace);
        return <button key={workspace} disabled={locked} title={locked ? "Commercial permission required" : undefined}
          className={props.activeWorkspace === workspace ? "active" : ""}
          onClick={() => props.onNavigate(workspace)}>
          <span>{index + 1}</span><strong>{label}</strong><small>{locked ? "Locked" : stage.status}</small>
        </button>;
      })}
    </nav>
    <div className="workspace-context-seal" aria-label={`Active workspace identity ${props.workspaceSeal}`}>
      <span>WORKSPACE LOCK</span><strong>{props.projectCode}</strong>
      <small>{props.workspaceSeal} · {dashboard?.facts.boqItems || 0} verified BOQ line{dashboard?.facts.boqItems === 1 ? "" : "s"} · records project-bound</small>
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
