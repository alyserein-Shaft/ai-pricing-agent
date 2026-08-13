import type { PreSalesWorkflow, ServerProjectDashboard } from "./types";
import { canonicalStepperItems, userFacingProjectReference, userFacingWorkspaceName } from "../../lib/project-navigation.mjs";

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
  const projectStatus = dashboard?.project.status || "Loading status…";
  const projectStatusClass = /completed|approved/i.test(projectStatus)
    ? "status-complete"
    : /failed|blocked|overdue/i.test(projectStatus)
      ? "status-blocked"
      : "status-neutral";
  const projectReference = userFacingProjectReference(props.projectCode);
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
    <div className="workspace-context-seal" aria-label={`Current project ${projectReference}`}>
      <span>PROJECT WORKSPACE</span><strong>{projectReference}</strong>
      <small>{userFacingWorkspaceName(props.activeWorkspace)} · {dashboard?.facts.boqItems || 0} BOQ item{dashboard?.facts.boqItems === 1 ? "" : "s"}</small>
    </div>
    <section className="project-strip" aria-label="Project status">
      <div><span className={`status-dot ${projectStatusClass}`}/><strong>Project status: {projectStatus}</strong>
        <small>{workflow ? `${workflow.progress}% workflow progress · ${workflow.blockers.length} blocker(s)` : "Reading verified project records"}</small></div>
      <div className="strip-progress"><span style={{ width: `${workflow?.progress || 0}%` }}/></div>
      <button disabled={!workflow?.nextAction} onClick={() => workflow?.nextAction && props.onOpenRoute(workflow.nextAction.route)}>
        {workflow?.nextAction?.title || "No action required"} →
      </button>
    </section>
  </>;
}
