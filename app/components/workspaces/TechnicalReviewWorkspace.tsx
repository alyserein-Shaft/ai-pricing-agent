import type { PreSalesWorkflow } from "../project/types";
import { PrerequisiteState } from "../shared/WorkspaceStates";
import { workspaceAvailability } from "../../lib/project-navigation.mjs";

export function TechnicalReviewWorkspace({ workflow, onOpenRoute }: { workflow: PreSalesWorkflow | null; onOpenRoute: (route: string) => void }) {
  const availability = workspaceAvailability(workflow, "Technical Review");
  const stages = workflow?.stages.filter((stage) => ["scope", "technical"].includes(stage.id)) || [];
  return <section className="module-page technical-review-workspace"><div className="module-heading"><div><small>TECHNICAL REVIEW</small><h1>Technical review</h1><p>Review scope and technical decisions independently from commercial approval.</p></div></div>
    {["BLOCKED", "WAITING"].includes(availability.state) ? <PrerequisiteState state={availability.state as "BLOCKED"|"WAITING"} title={availability.title} detail={availability.detail} action="Open prerequisite" onAction={() => onOpenRoute(availability.route)}/> : <div className="persistent-review-list">{stages.map((stage) => <article key={stage.id}><header><div><small>{stage.owner}</small><strong>{stage.name}</strong></div><span className={stage.status === "Completed" ? "review-ready" : "review-pending"}>{stage.status}</span></header><p>{stage.blockers[0] || stage.action}</p><footer><small>{stage.progress}% complete</small>{stage.route && <button onClick={() => onOpenRoute(stage.route)}>{stage.action || "Open review"}</button>}</footer></article>)}</div>}
  </section>;
}
