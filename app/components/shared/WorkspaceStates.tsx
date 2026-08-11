export function LoadingState({ label = "Loading verified records…" }: { label?: string }) {
  return <div className="empty-state" role="status"><strong>{label}</strong></div>;
}
export function ErrorState({ message }: { message: string }) {
  return <div className="dashboard-error" role="alert"><strong>Workspace unavailable</strong><p>{message}</p></div>;
}
export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <div className="empty-state"><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}
export function PrerequisiteState({ state, title, detail, action, onAction }: { state: "EMPTY"|"WAITING"|"BLOCKED"; title: string; detail: string; action: string; onAction: () => void }) {
  return <div className={`empty-state workspace-state workspace-state-${state.toLowerCase()}`} role="status"><small>{state}</small><strong>{title}</strong><p>{detail}</p><button className="inline-primary" onClick={onAction}>{action}</button></div>;
}
