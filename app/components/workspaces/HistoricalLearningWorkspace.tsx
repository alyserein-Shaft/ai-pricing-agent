type Props = {
  summary: Record<string, unknown>;
  cards: Record<string, unknown>[];
  loading: boolean;
  error: string;
  search: string;
  onSearch: (value: string) => void;
  onLearn: () => void;
  canLearn: boolean;
};

export function HistoricalLearningWorkspace({ summary, cards, loading, error, search, onSearch, onLearn, canLearn }: Props) {
  return <section className="module-page product-library-page">
    <div className="module-heading"><div><small>UNDERSTAND → LEARN → REMEMBER</small><h1>Pricing Memory</h1><p>Source-backed completed-project experience. Historical evidence is never approved costing evidence.</p></div><button disabled={loading || !canLearn} onClick={onLearn}>{loading ? "Learning…" : "Understand selected project"}</button></div>
    <div className="library-safety-banner"><strong>Historical Only · Not reusable automatically</strong><span>Price types remain separate and every observation retains provenance.</span></div>
    {error && <div className="dashboard-error" role="alert">{error}</div>}
    <div className="extraction-proof"><span><small>PROJECTS</small><strong>{String(summary.projects_learned || 0)}</strong></span><span><small>PRODUCTS</small><strong>{String(summary.products_learned || 0)}</strong></span><span><small>PRICES</small><strong>{String(summary.historical_prices || 0)}</strong></span></div>
    <label className="library-search"><span>Search remembered experience</span><input value={search} onChange={(event) => onSearch(event.target.value)} /></label>
    <div className="library-results">{cards.map((card, index) => <article key={String(card.part_number || index)}><div><strong>{String(card.part_number || "Unknown product")}</strong><p>{String(card.observations || 0)} source observations · {String(card.projects || 0)} projects</p></div><b className="review-blocked">Historical Only</b></article>)}{!loading && !cards.length && <div className="empty-state">No remembered experience yet.</div>}</div>
  </section>;
}
