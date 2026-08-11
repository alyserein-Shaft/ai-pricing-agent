export function LoadingState({ label = "Loading verified records…" }: { label?: string }) {
  return <div className="empty-state" role="status"><strong>{label}</strong></div>;
}
export function ErrorState({ message }: { message: string }) {
  return <div className="dashboard-error" role="alert"><strong>Workspace unavailable</strong><p>{message}</p></div>;
}
export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <div className="empty-state"><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}
