"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

type BomLine = {
  boqItemId?: string;
  description?: string;
  readiness?: { state?: string; label?: string };
  roles?: Record<string, unknown[]>;
  warnings?: string[];
};

type BomSummary = {
  counts?: Record<string, number>;
  unresolvedLines?: BomLine[];
  lines?: BomLine[];
};

const ROLE_ORDER = ["REQUIRED", "CONDITIONAL", "OPTIONAL", "ALTERNATIVE"];

export function BomWorkspace({ projectId }: { projectId: string }) {
  const [summary, setSummary] = useState<BomSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/bom-summary`, { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok && response.status !== 404) throw new Error(value?.error?.message || "The BOM summary could not be loaded.");
        return value;
      })
      .then((value) => { if (active) setSummary(value && !value.error ? value : null); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "The BOM summary could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  if (loading) return <section className="module-page bom-page"><LoadingState label="Loading BOM evidence…" /></section>;
  if (error) return <section className="module-page bom-page"><ErrorState message={error} /></section>;
  if (!summary) {
    return <section className="module-page bom-page">
      <div className="module-heading"><div><small>ENGINEERING · BOM</small><h1>BOM</h1></div></div>
      <EmptyState title="No BOM yet" detail="Derived accessories appear here once products are selected. Derived rows are never independent tender quantities." />
    </section>;
  }

  const lines = summary.unresolvedLines || summary.lines || [];
  return <section className="module-page bom-page">
    <div className="module-heading">
      <div>
        <small>ENGINEERING · BOM</small>
        <h1>BOM</h1>
        <p>Selected main products with derived accessories by role. Quantities show their derivation; derived rows are never tender demand.</p>
      </div>
    </div>
    {summary.counts && <div className="bom-counts">
      {Object.entries(summary.counts).map(([state, count]) => <span key={state}>{state}: {count}</span>)}
    </div>}
    {lines.map((line, index) => <article key={line.boqItemId || index} className="bom-line">
      <strong>{line.description || line.boqItemId}</strong>
      <span>{line.readiness?.label || line.readiness?.state}</span>
      {line.roles && ROLE_ORDER.filter((role) => (line.roles as Record<string, unknown[]>)[role]?.length).map((role) => <div key={role}>
        <h4>{role}</h4>
        <ul>{((line.roles as Record<string, unknown[]>)[role] || []).map((item, itemIndex) => <li key={itemIndex}>{typeof item === "object" ? JSON.stringify(item) : String(item)}</li>)}</ul>
      </div>)}
      {(line.warnings || []).map((warning, warningIndex) => <p key={warningIndex} className="bom-warning">{warning}</p>)}
    </article>)}
  </section>;
}
