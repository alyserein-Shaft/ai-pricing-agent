type Props = {
  section: string;
  files: Record<string, unknown>[];
  results: Record<string, unknown>[];
  summary: Record<string, unknown>;
  loading: boolean;
  error: string;
  search: string;
  onSearch: (value: string) => void;
  onFiles: (files: File[]) => void;
};

export function KnowledgeLibraryWorkspace({
  section,
  files,
  results,
  summary,
  loading,
  error,
  search,
  onSearch,
  onFiles,
}: Props) {
  const subsectionTitle = section === "Price Lists"
      ? "Prices"
      : section === "Product governance"
        ? "Product governance"
      : section === "Commercial"
        ? "Commercial"
      : section;

  return (
    <section className="module-page product-library-page">
      <div className="module-heading">
        <div>
          <small>KNOWLEDGE · UPLOAD → LEARN → ORGANIZE → USE</small>
          <h1>{subsectionTitle}</h1>
          <p>Searchable, source-backed company engineering knowledge.</p>
        </div>
        <label className="button">
          <input
            hidden
            multiple
            type="file"
            onChange={(event) => onFiles(Array.from(event.target.files || []))}
          />
          {loading ? "Learning…" : "＋ Upload knowledge"}
        </label>
      </div>
      <div className="library-safety-banner">
        <strong>No automatic promotion</strong>
        <span>
          Historical evidence, reusable knowledge, product approval, and price
          approval remain separate.
        </span>
      </div>
      {error && (
        <div className="dashboard-error" role="alert">
          {error}
        </div>
      )}
      <div className="extraction-proof knowledge-metrics">
        <span>
          <small>FILES</small>
          <strong>{String(summary.files || files.length)}</strong>
        </span>
        <span>
          <small>RESULTS</small>
          <strong>{String(results.length)}</strong>
        </span>
      </div>

      {section === "Products" && (
        <div className="products-filter">
          <div className="filter-row">
            <span>Filter by:</span>
            <select
              value={productFilter || ""}
              onChange={(event) => onSearch(event.target.value)}
              style={{minWidth: '120px', marginRight: '8px'}}>
              <option value="">Part number</option>
              <option value="Honeywell-IFP2100HV">Honeywell IFP-2100HV</option>
              <option value="Farenhyt-IFP2100">Farenhyt IFP-2100</option>
            </select>
            <select
              value={productFamilyFilter || ""}
              onChange={(event) => onSearch(event.target.value)}
              style={{minWidth: '100px', marginRight: '8px'}}>
              <option value="">Family</option>
              <option value="IFP-2100">IFP-2100</option>
              <option value="IFP-2200">IFP-2200</option>
            </select>
            <select
              value={productManufacturerFilter || ""}
              onChange={(event) => onSearch(event.target.value)}
              style={{minWidth: '110px', marginRight: '8px'}}>
              <option value="">Manufacturer</option>
              <option value="Honeywell">Honeywell</option>
              <option value="Farenhyt">Farenhyt</option>
            </select>
            <select
              value={productBrandFilter || ""}
              onChange={(event) => onSearch(event.target.value)}
              style={{minWidth: '100px'}}>
              <option value="">Brand</option>
              <option value="Farenhyt">Farenhyt</option>
            </select>
          </div>
        </div>
      )}
      <label className="library-search">
        <span>Search {subsectionTitle.toLowerCase()}</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <div className="library-results">
        {files.map((file, index) => (
          <article key={String(file.id || index)}>
            <div>
              <strong>
                {String(file.file_name || file.name || "Unnamed source")}
              </strong>
              <p>
                {String(
                  file.document_type || file.source_type || "Unclassified",
                )}
              </p>
            </div>
            <div>
              <b className="review-blocked">
                Review: {String(file.review_status || "Needs Review")}
              </b>
              <br />
              <small>
                Permitted use: {String(file.downstream_use || "Discovery Only")}
              </small>
            </div>
          </article>
        ))}
        {!loading && !files.length && (
          <div className="empty-state">
            {section === "Products"
              ? "No catalog products match these filters."
              : section === "Price Lists"
              ? "No pricing records for this product."
              : section === "Product governance"
              ? "No product governance facts match the current filters."
              : section === "Master data"
              ? "No master data records match the current filters."
              : section === "Sources"
              ? "No source documents match the current filters."
              : `No {subsectionTitle.toLowerCase()} found.`
            }
          </div>
        )}
      </div>
    </section>
  );
}
