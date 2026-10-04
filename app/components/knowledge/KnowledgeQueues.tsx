"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";
import { KnowledgeFactCard, type KnowledgeFact } from "./KnowledgeFactCard";
import { KnowledgeConflictCard, type KnowledgeConflict } from "./KnowledgeConflictCard";

// Facts queue: atomic technical/commercial facts from the governed review
// queue, each rendered with full scope. Conflicted facts are excluded here --
// they belong to the Conflicts view, never mixed into the clean list.
export function KnowledgeFactList() {
  const [facts, setFacts] = useState<KnowledgeFact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/knowledge/review-queue", { cache: "no-store" })
      .then(async (r) => { const v = await r.json(); if (!r.ok) throw new Error(v?.error?.message || "Facts are unavailable."); return v; })
      .then((value) => {
        if (!active) return;
        const items: unknown[] = Array.isArray(value?.items) ? value.items : [];
        setFacts(items
          .filter((entry) => (entry as Record<string, unknown>).item_kind === "Fact")
          .filter((entry) => String((entry as Record<string, unknown>).review_status || "").toLowerCase() !== "conflicted")
          .map((entry) => {
            const row = entry as Record<string, unknown>;
            return {
              id: String(row.id || ""),
              attribute: String(row.item_type || row.fact_type || "fact"),
              value: String(row.title || row.original_value || ""),
              scope: (row.scope as string) || null,
              source: (row.source_file_id as string) || null,
              reviewState: (row.review_status as string) || null,
            } as KnowledgeFact;
          }));
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Facts are unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <LoadingState label="Loading governed facts…" />;
  if (error) return <ErrorState message={error} />;
  if (!facts || !facts.length) return <EmptyState title="No facts awaiting review" detail="Promoted facts appear here with full engineering scope." />;
  return <div className="knowledge-fact-list">{facts.map((fact) => <KnowledgeFactCard key={fact.id} fact={fact} />)}</div>;
}

// Conflicts queue: conflicted facts rendered Source A vs Source B with the
// governed resolve action. Raw-JSON comparison is never required.
export function KnowledgeConflictList({ onResolved }: { onResolved?: () => void }) {
  const [conflicts, setConflicts] = useState<KnowledgeConflict[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/knowledge/review-queue", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message || "Conflicts are unavailable.");
      const items: unknown[] = Array.isArray(value?.items) ? value.items : [];
      setConflicts(items
        .filter((entry) => String((entry as Record<string, unknown>).review_status || "").toLowerCase() === "conflicted")
        .map((entry) => {
          const row = entry as Record<string, unknown>;
          const details = (row.source_details as Record<string, unknown>) || {};
          const side = (key: string) => (details[key] as Record<string, string>) || {};
          return {
            id: String(row.id || ""),
            subject: String(row.title || "Untitled conflict"),
            sourceA: { label: "Source A", value: String(side("a").value || side("left")?.value || "") },
            sourceB: { label: "Source B", value: String(side("b").value || side("right")?.value || "") },
            impact: (row.impact as string) || undefined,
          } as KnowledgeConflict;
        }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conflicts are unavailable.");
      setConflicts(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { let active = true; void (async () => { if (active) await load(); })(); return () => { active = false; }; }, []);
  if (loading) return <LoadingState label="Loading conflicts…" />;
  if (error) return <ErrorState message={error} />;
  if (!conflicts || !conflicts.length) return <EmptyState title="No open conflicts" detail="Contradictory evidence will appear here Source A vs Source B." />;
  return <div className="knowledge-conflict-list">{conflicts.map((conflict) => (
    <KnowledgeConflictCard key={conflict.id} conflict={conflict} onResolved={() => { if (onResolved) onResolved(); void load(); }} />
  ))}</div>;
}
