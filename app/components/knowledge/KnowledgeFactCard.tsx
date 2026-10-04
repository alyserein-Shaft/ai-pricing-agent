"use client";

// Atomic fact card. Every scoped dimension is explicit; a capacity fact shows
// its full scope (never a bare number). Raw evidence JSON stays behind
// Advanced. Review state uses the shared status vocabulary tones.
const toneFor = (reviewState: string) => {
  const value = String(reviewState || "").toLowerCase();
  if (/(approved|reviewed|trusted|current)/.test(value)) return "review-ready";
  if (/(reject|conflict|blocked|failed)/.test(value)) return "review-blocked";
  return "review-pending";
};

export type KnowledgeFact = {
  id: string;
  attribute: string;
  value: string;
  unit?: string | null;
  scope?: string | null;
  resourceClass?: string | null;
  product?: string | null;
  model?: string | null;
  protocol?: string | null;
  source?: string | null;
  authority?: string | null;
  reviewState?: string | null;
  evidenceJson?: unknown;
};

export function scopedFactLabel(fact: KnowledgeFact) {
  const parts = [fact.value, fact.unit].filter(Boolean).join(" ");
  const scope = [fact.resourceClass, fact.scope, fact.protocol].filter(Boolean).join(" / ");
  return scope ? `${parts} — ${scope}` : parts;
}

export function KnowledgeFactCard({ fact }: { fact: KnowledgeFact }) {
  return <article className="knowledge-fact-card">
    <header>
      <strong>{fact.attribute}</strong>
      <span className={toneFor(fact.reviewState || "")}>{fact.reviewState || "Needs review"}</span>
    </header>
    <p className="fact-value">{scopedFactLabel(fact)}</p>
    <small>{[fact.product || fact.model, fact.source, fact.authority].filter(Boolean).join(" · ")}</small>
    {fact.evidenceJson != null && (
      <details><summary>Advanced (raw evidence)</summary>
        <pre>{JSON.stringify(fact.evidenceJson, null, 2)}</pre>
      </details>
    )}
  </article>;
}
