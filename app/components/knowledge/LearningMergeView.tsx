"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

// Unified Learning: case studies (project lessons) + historical learning
// (validated patterns) in one surface, replacing the two duplicated lists.
// Experimental/unreviewed observations stay labelled and can never override
// current project evidence.
type LearningItem = {
  id: string;
  kind: string;
  title: string;
  system?: string;
  status?: string;
  reusable?: boolean;
  source?: string;
};

export function LearningMergeView() {
  const [items, setItems] = useState<LearningItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/case-studies", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then((cases) => {
        if (!active) return;
        const rows: LearningItem[] = [];
        const caseList: unknown[] = Array.isArray(cases.body?.cases) ? cases.body.cases : Array.isArray(cases.body) ? cases.body : [];
        for (const entry of caseList) {
          const row = entry as Record<string, unknown>;
          rows.push({ id: String(row.id || row.case_id || ""), kind: "Project lesson", title: String(row.title || row.name || "Untitled case"), system: row.system as string | undefined, status: row.status as string | undefined, reusable: Boolean(row.reusable), source: "case-study" });
        }
        setItems(rows);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Learning items are unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <LoadingState label="Loading learning items…" />;
  if (error) return <ErrorState message={error} />;
  if (!items || !items.length) return <EmptyState title="No learning items" detail="Frozen project lessons and validated patterns will appear here." />;
  const reusable = items.filter((item) => item.reusable);
  const lessons = items.filter((item) => !item.reusable);
  return <div className="learning-merge">
    {reusable.length > 0 && <section><h3>Validated reusable patterns ({reusable.length})</h3>
      {reusable.map((item) => <article key={item.id}><strong>{item.title}</strong><small>{item.system || ""} · {item.status || " pattern"}</small></article>)}
    </section>}
    {lessons.length > 0 && <section><h3>Project lessons ({lessons.length})</h3>
      {lessons.map((item) => <article key={item.id}><strong>{item.title}</strong><small>{item.system || ""} · historical only, never overrides current evidence</small></article>)}
    </section>}
  </div>;
}
