"use client";

import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

// Lightweight engineer-facing product search. Search + evidence only: no
// upload, promotion, review, or governance controls are rendered here, so this
// surface is safe to mount inside the project journey.
export function EngineerProductSearch({ projectId }: { projectId?: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    const needle = query.trim();
    if (!needle) { setResults(null); return; }
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ q: needle });
      if (projectId) params.set("projectId", projectId);
      const response = await fetch(`/api/knowledge/search?${params.toString()}`, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message || "Product search is unavailable.");
      setResults(Array.isArray(value?.results) ? value.results : Array.isArray(value?.items) ? value.items : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Product search is unavailable.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return <section className="engineer-product-search">
    <div className="module-heading"><div><small>PROJECT · PRODUCT SEARCH</small><h2>Search Product Library</h2>
      <p>Exact products with matching evidence, key facts, compatibility and lifecycle. No admin controls here.</p></div></div>
    <div className="search-row">
      <input aria-label="Search products" value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder="Part number, model, or description" onKeyDown={(event) => { if (event.key === "Enter") void search(); }} />
      <button onClick={() => void search()} disabled={loading}>{loading ? "Searching…" : "Search"}</button>
    </div>
    {loading && <LoadingState label="Searching governed products…" />}
    {error && <ErrorState message={error} />}
    {!loading && !error && results != null && !results.length && (
      <EmptyState title="No products match" detail="Try a part number, model, or family name." />
    )}
    {!loading && results != null && results.length > 0 && (
      <div className="product-search-results">
        {results.map((row, index) => (
          <article key={String(row.id || row.partNumber || index)}>
            <strong>{String(row.partNumber || row.title || "Untitled product")}</strong>
            <small>{[row.manufacturer, row.brand, row.family].filter(Boolean).join(" · ")}</small>
            {row.lifecycle != null && <small>Lifecycle: {String(row.lifecycle)}</small>}
            {row.compatibility != null && <small>Compatibility: {String(row.compatibility)}</small>}
            {row.evidence != null && <small>Evidence: {String(row.evidence)}</small>}
          </article>
        ))}
      </div>
    )}
  </section>;
}
