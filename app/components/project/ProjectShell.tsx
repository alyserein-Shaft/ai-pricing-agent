import type { PreSalesWorkflow, ServerProjectDashboard } from "./types";
import { userFacingProjectReference, userFacingWorkspaceName } from "../../lib/project-navigation.mjs";
import { currentVisiblePhase, visibleProjectPhases } from "../../lib/project-phase-presentation.mjs";

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
  const phases = visibleProjectPhases(workflow);
  const currentPhase = currentVisiblePhase(workflow);
  return <>
    <nav className="project-workflow-tabs" aria-label="Project estimation workflow">
      <label className="compact-phase-control">
        <span>Current phase</span>
        <select aria-label="Current project phase" value={currentPhase?.id || "set-up"}
          onChange={(event) => props.onNavigate(phases.find((phase) => phase.id === event.target.value)?.workspace || "Overview")}>
          {phases.map((phase, index) => <option key={phase.id} value={phase.id}>{index + 1}. {phase.label} — {phase.state}</option>)}
        </select>
      </label>
      {phases.map((item, index) => {
        const label = item.label;
        const workspace = item.workspace;
        const locked = !props.canViewCommercial && ["Costing", "Quotation"].includes(workspace);
        return <button key={item.id} disabled={locked} title={locked ? "Commercial permission required" : undefined}
          className={`${item.current ? "active" : ""} phase-${item.state.toLowerCase().replaceAll(" ", "-")}`}
          onClick={() => props.onNavigate(workspace)}>
          <span>{index + 1}</span><strong>{label}</strong><small>{locked ? "Locked" : item.state}</small>
        </button>;
      })}
    </nav>
    <div className="workspace-context-seal" aria-label={`Current project ${projectReference}`}>
      <span>PROJECT WORKSPACE</span><strong>{projectReference}</strong>
      <small>{userFacingWorkspaceName(props.activeWorkspace)} · {dashboard?.facts.boqItems || 0} BOQ item{dashboard?.facts.boqItems === 1 ? "" : "s"}</small>
    </div>
    <section className="project-strip" aria-label="Project status">
      <div><span className={`status-dot ${projectStatusClass}`}/><strong>Project status: {projectStatus}</strong>
        <small>{workflow ? `${workflow.blockers.length} blocker(s) · ${workflow.warnings.length} warning(s)` : "Reading verified project records"}</small></div>
      <button disabled={!workflow?.nextAction} onClick={() => workflow?.nextAction && props.onOpenRoute(workflow.nextAction.route)}>
        {workflow?.nextAction?.title || "No action required"} →
      </button>
    </section>
  </>;
}
