"use client";

import { useState } from "react";
import { ErrorState } from "../shared/WorkspaceStates";

// Source A vs Source B conflict card. Differences are shown field by field so
// nobody compares raw JSON; resolution goes through the existing governed
// resolve endpoint and never edits facts inline.
export type KnowledgeConflict = {
  id: string;
  subject: string;
  sourceA: { label: string; value: string; model?: string; region?: string; revision?: string; authority?: string };
  sourceB: { label: string; value: string; model?: string; region?: string; revision?: string; authority?: string };
  impact?: string;
};

export function KnowledgeConflictCard({ conflict, onResolved }: { conflict: KnowledgeConflict; onResolved?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");

  const resolve = async (winner: "A" | "B") => {
    if (!reason.trim()) { setError("A reason is required to resolve a conflict."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/knowledge/resolve/fact/${encodeURIComponent(conflict.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ winner, reason: reason.trim() }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message || "The conflict could not be resolved.");
      if (onResolved) onResolved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The conflict could not be resolved.");
    } finally {
      setBusy(false);
    }
  };

  const rows: Array<[string, string | undefined, string | undefined]> = [
    ["Value", conflict.sourceA.value, conflict.sourceB.value],
    ["Model / variant", conflict.sourceA.model, conflict.sourceB.model],
    ["Region", conflict.sourceA.region, conflict.sourceB.region],
    ["Revision / date", conflict.sourceA.revision, conflict.sourceB.revision],
    ["Authority", conflict.sourceA.authority, conflict.sourceB.authority],
  ];
  return <article className="knowledge-conflict-card">
    <header><strong>{conflict.subject}</strong></header>
    <table>
      <thead><tr><th>Field</th><th>{conflict.sourceA.label}</th><th>{conflict.sourceB.label}</th></tr></thead>
      <tbody>{rows.map(([field, a, b]) => (
        <tr key={field} className={a !== b ? "differs" : ""}><td>{field}</td><td>{a || "—"}</td><td>{b || "—"}</td></tr>
      ))}</tbody>
    </table>
    {conflict.impact && <p>Engineering impact: {conflict.impact}</p>}
    <textarea aria-label={`Resolution reason for ${conflict.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why does one source win?" />
    {error && <ErrorState message={error} />}
    <footer>
      <button disabled={busy} onClick={() => void resolve("A")}>Resolve: keep A</button>
      <button disabled={busy} onClick={() => void resolve("B")}>Resolve: keep B</button>
    </footer>
  </article>;
}
