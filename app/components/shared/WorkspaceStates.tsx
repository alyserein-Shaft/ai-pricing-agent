export function LoadingState({ label = "Loading verified records…" }: { label?: string }) {
  return <div className="empty-state" role="status"><strong>{label}</strong></div>;
}
export function ErrorState({ message }: { message: string }) {
  return <div className="dashboard-error" role="alert"><strong>Workspace unavailable</strong><p>{message}</p></div>;
}
export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <div className="empty-state"><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}
export function PrerequisiteState({ state, statusLabel, title, detail, action, onAction }: { state: "EMPTY"|"WAITING"|"BLOCKED"; statusLabel?: string; title: string; detail: string; action: string; onAction: () => void }) {
  const semanticLabel = statusLabel || ({ EMPTY: "Not started", WAITING: "Waiting", BLOCKED: "Blocked" } as const)[state];
  return <div className={`empty-state workspace-state workspace-state-${state.toLowerCase()}`} role="status">
    <span className="workspace-state-badge">{semanticLabel}</span>
    <strong className="workspace-state-title">{title}</strong>
    <p>{detail}</p>
    <button className="inline-primary" onClick={onAction}>{action}</button>
  </div>;
}
