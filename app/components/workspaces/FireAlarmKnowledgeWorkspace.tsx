"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

type FamilyRow = { family: string; category: string; activeProductCount: number; coverageState: string };
type CountRow = { role?: string; status?: string; count: number };
type ProductRow = { partNumber: string; manufacturer: string; family: string | null; productRole: string; evidenceCount: number; hasTechnicalDetail: boolean; hasPriceEvidence: boolean };
type AttributeRow = { attribute: string; applicableFamilies: string[]; productCoverage: number };
type SourceRow = { sourceType: string; authority: string; fileName: string; validityState: string };
type GapRow = { area: string; gap: string; impact: string };
type ValidationGapRow = GapRow & { validationEvidence: string };

type Overview = {
  generatedAt: string;
  taxonomy: { version: string; totalFamilies: number; populatedFamilies: number; zeroCoverageFamilies: number; familiesWithNoDbRow: number };
  families: FamilyRow[];
  products: {
    manufacturer: string; total: number; classified: number; unclassified: number;
    withSourceEvidence: number; withModernAttributes: number; withLegacyAttributesOnly: number;
    withLegacyStandards: number; withModernCertifications: number; withApprovedAccessoryRelationship: number; withLifecycleEvents: number;
  };
  productRoleDistribution: CountRow[];
  reviewStatusDistribution: CountRow[];
  lifecycleDistribution: CountRow[];
  productList: ProductRow[];
  attributes: AttributeRow[];
  manufacturers: { registeredSources: SourceRow[]; externallyResearchedCitations: number };
  pricing: {
    productsWithPriceEvidence: number; currentPriceRecords: number; historicalPriceRecords: number; expiredPriceRecords: number;
    approvedPriceRecords: number; projectSpecificPriceRecords: number; globalPriceRecords: number;
    downstreamUseDistribution: { downstreamUse: string; count: number }[];
  };
  coverageGaps: { status: string; gaps: GapRow[] };
  governance: {
    taxonomyVersion: string;
    goldenValidation: { status: string; summary: string; detail: string };
    validationGaps: ValidationGapRow[];
  };
};

const PRIMARY_TABS = ["Overview", "Families", "Products", "Gaps"] as const;
const ADVANCED_TABS = ["Attributes", "Evidence", "Pricing", "Governance"] as const;
type Tab = (typeof PRIMARY_TABS)[number] | (typeof ADVANCED_TABS)[number];

export function FireAlarmKnowledgeWorkspace() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  const [productFilter, setProductFilter] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    fetch("/api/knowledge/fire-alarm/overview", { cache: "no-store" })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value?.error?.message || "The Fire Alarm knowledge overview could not be loaded."); return value; })
      .then((value) => { if (active) setData(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "The Fire Alarm knowledge overview could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filteredProducts = useMemo(() => {
    if (!data) return [];
    const needle = productFilter.trim().toLowerCase();
    if (!needle) return data.productList;
    return data.productList.filter((row) =>
      row.partNumber.toLowerCase().includes(needle) || (row.family || "").toLowerCase().includes(needle) || row.productRole.toLowerCase().includes(needle));
  }, [data, productFilter]);

  return <section className="module-page fire-alarm-knowledge-page">
    <div className="module-heading">
      <div>
        <small>KNOWLEDGE · SYSTEMS · FIRE ALARM</small>
        <h1>Fire Alarm System Pack</h1>
        <p>Browse Fire Alarm families, products, and open engineering gaps. Advanced knowledge governance remains available when deeper review is needed.</p>
      </div>
    </div>
    {error && <ErrorState message={error}/>}
    {loading && <LoadingState label="Loading Fire Alarm knowledge overview…"/>}
    {!loading && data && <>
      <div className="fire-alarm-engineer-navigation">
        <div className="fire-alarm-knowledge-tabs" role="tablist" aria-label="Fire Alarm engineer view">
          {PRIMARY_TABS.map((name) => (
            <button key={name} type="button" role="tab" aria-selected={tab === name}
              className={tab === name ? "fire-alarm-knowledge-tab is-active" : "fire-alarm-knowledge-tab"}
              onClick={() => setTab(name)}>{name}</button>
          ))}
        </div>

        <details className="fire-alarm-advanced">
          <summary>Advanced / Governance</summary>
          <div className="fire-alarm-advanced-tabs" role="tablist" aria-label="Fire Alarm advanced knowledge">
            {ADVANCED_TABS.map((name) => (
              <button key={name} type="button" role="tab" aria-selected={tab === name}
                className={tab === name ? "fire-alarm-knowledge-tab is-active" : "fire-alarm-knowledge-tab"}
                onClick={() => setTab(name)}>{name}</button>
            ))}
          </div>
        </details>
      </div>

      {tab === "Overview" && <>
        <section className="decision-section">
          <div className="fire-alarm-overview-heading">
            <div>
              <h3>Fire Alarm at a glance</h3>
              <p>What an engineer needs to know before using this system pack on a project.</p>
            </div>
            <span className="fire-alarm-golden-badge">Validated · Ready for use</span>
          </div>

          <div className="extraction-proof knowledge-metrics fire-alarm-engineer-metrics">
            <span><small>FAMILIES</small><strong>{data.taxonomy.totalFamilies}</strong><em>{data.taxonomy.populatedFamilies} populated</em></span>
            <span><small>PRODUCTS</small><strong>{data.products.total}</strong><em>{data.products.manufacturer}</em></span>
            <span><small>CLASSIFIED</small><strong>{data.products.classified}</strong><em>{data.products.unclassified} still unclassified</em></span>
            <span><small>WITH EVIDENCE</small><strong>{data.products.withSourceEvidence}</strong><em>of {data.products.total} products</em></span>
            <span><small>PRICE EVIDENCE</small><strong>{data.pricing.productsWithPriceEvidence}</strong><em>products priced</em></span>
            <span><small>OPEN GAPS</small><strong>{data.coverageGaps.gaps.length}</strong><em>Known selection gaps</em></span>
          </div>
        </section>

        {data.coverageGaps.gaps.length > 0 && <section className="decision-section fire-alarm-attention">
          <h3>Needs attention</h3>
          <p>{data.coverageGaps.gaps.length} known selection gap{data.coverageGaps.gaps.length === 1 ? "" : "s"} may affect product choice on some projects.</p>
          <button type="button" className="inline-link" onClick={() => setTab("Gaps")}>View gaps →</button>
        </section>}

        <p className="fire-alarm-system-meta">
          Last updated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </>}

      {tab === "Families" && <section className="decision-section">
        <h3>Families</h3>
        <div className="compact-table"><table><thead><tr><th>Family</th><th>Category</th><th>Products</th><th>Availability</th></tr></thead><tbody>
          {data.families.map((row) => <tr key={row.family}>
            <td><b>{row.family}</b></td>
            <td>{row.category}</td>
            <td>{row.activeProductCount}</td>
            <td><small>{row.coverageState}</small></td>
          </tr>)}
        </tbody></table></div>
        {!data.families.length && <EmptyState title="No taxonomy families" detail="Fire Alarm taxonomy did not return any families."/>}
      </section>}

      {tab === "Products" && <section className="decision-section">
        <h3>Products <small>({filteredProducts.length} of {data.productList.length})</small></h3>
        <input type="search" placeholder="Filter by part number, family, or role…" value={productFilter}
          onChange={(event) => setProductFilter(event.target.value)} className="fire-alarm-knowledge-filter"/>
        <div className="compact-table" style={{ maxHeight: 520, overflowY: "auto" }}>
          <table><thead><tr><th>Part number</th><th>Family</th><th>Role</th><th>Technical detail</th><th>Price evidence</th></tr></thead><tbody>
            {filteredProducts.slice(0, 300).map((row) => <tr key={row.partNumber}>
              <td><b>{row.partNumber}</b></td>
              <td>{row.family || <small>Unclassified</small>}</td>
              <td>{row.productRole}</td>
              <td>{row.hasTechnicalDetail ? "Available" : <small>Limited — engineer review may be needed</small>}</td>
              <td>{row.hasPriceEvidence ? "Available" : <small>Supplier RFQ required</small>}</td>
            </tr>)}
          </tbody></table>
        </div>
        {filteredProducts.length > 300 && <p className="decision-open-note">Showing the first 300 of {filteredProducts.length} matching products — narrow the filter to see more.</p>}
        {!filteredProducts.length && <EmptyState title="No matching products" detail="Try a different filter."/>}
      </section>}

      {tab === "Attributes" && <section className="decision-section">
        <h3>Governed attributes</h3>
        <p className="decision-open-note">Product coverage is a presence signal (this attribute name appears somewhere in the product&apos;s Product Knowledge), not a re-verification of every value.</p>
        <div className="compact-table"><table><thead><tr><th>Attribute</th><th>Applicable families</th><th>Product coverage</th></tr></thead><tbody>
          {data.attributes.map((row) => <tr key={row.attribute}>
            <td><b>{row.attribute}</b></td>
            <td><small>{row.applicableFamilies.length} families</small></td>
            <td>{row.productCoverage}</td>
          </tr>)}
        </tbody></table></div>
      </section>}

      {tab === "Evidence" && <section className="decision-section">
        <h3>Manufacturers &amp; Evidence</h3>
        <ul className="decision-requirement-list">
          <li>Manufacturer in scope: <b>{data.products.manufacturer}</b></li>
          <li>Registered bulk-import sources (product_sources): <b>{data.manufacturers.registeredSources.length}</b></li>
          <li>Products with an individually-cited manufacturer document (datasheet/manual): <b>{data.manufacturers.externallyResearchedCitations}</b> / {data.products.total}</li>
        </ul>
        <div className="compact-table"><table><thead><tr><th>Source type</th><th>Authority</th><th>File</th><th>Validity</th></tr></thead><tbody>
          {data.manufacturers.registeredSources.map((row, index) => <tr key={`${row.fileName}-${index}`}>
            <td>{row.sourceType}</td>
            <td>{row.authority}</td>
            <td><small>{row.fileName}</small></td>
            <td><small>{row.validityState}</small></td>
          </tr>)}
        </tbody></table></div>
        {!data.manufacturers.registeredSources.length && <EmptyState title="No registered bulk-import sources" detail="Catalog data may only carry individually-cited evidence."/>}
      </section>}

      {tab === "Pricing" && <section className="decision-section">
        <h3>Pricing</h3>
        <div className="extraction-proof knowledge-metrics">
          <span><small>PRODUCTS WITH PRICE EVIDENCE</small><strong>{data.pricing.productsWithPriceEvidence}</strong></span>
          <span><small>CURRENT PRICE RECORDS</small><strong>{data.pricing.currentPriceRecords}</strong></span>
          <span><small>HISTORICAL PRICE RECORDS</small><strong>{data.pricing.historicalPriceRecords}</strong></span>
          <span><small>EXPIRED PRICE RECORDS</small><strong>{data.pricing.expiredPriceRecords}</strong></span>
          <span><small>APPROVED PRICE RECORDS</small><strong>{data.pricing.approvedPriceRecords}</strong></span>
        </div>
        <ul className="decision-requirement-list">
          <li>Project-specific price records: <b>{data.pricing.projectSpecificPriceRecords}</b></li>
          <li>Global (catalog-wide) price records: <b>{data.pricing.globalPriceRecords}</b></li>
        </ul>
        <h4>Downstream use</h4>
        <ul className="decision-requirement-list">
          {data.pricing.downstreamUseDistribution.map((row) => <li key={row.downstreamUse}><b>{row.downstreamUse}</b>: {row.count}</li>)}
        </ul>
        <p className="decision-open-note">Zero &quot;Current&quot; records is an honest state, not a defect: no price list in this catalog has yet been reviewed and marked current — a historical price is never silently promoted to current.</p>
      </section>}

      {tab === "Gaps" && <section className="decision-section">
        <h3>Known selection gaps</h3>
        <p className="decision-open-note">These are known limits on what the system can confidently decide on its own — not defects. Where a gap applies, expect an engineer decision to be needed.</p>

        <div className="compact-table"><table><thead><tr><th>Area</th><th>Gap</th><th>Impact</th></tr></thead><tbody>
          {data.coverageGaps.gaps.map((row, index) => <tr key={index}>
            <td><small>{row.area}</small></td>
            <td><b>{row.gap}</b></td>
            <td><small>{row.impact}</small></td>
          </tr>)}
        </tbody></table></div>

        {!data.coverageGaps.gaps.length && <EmptyState
          title="No known Fire Alarm gaps"
          detail="No currently documented selection gap requires attention."
        />}
      </section>}

      {tab === "Governance" && <>
        <section className="decision-section">
          <h3>Release validation</h3>
          <ul className="decision-requirement-list">
            <li>Taxonomy version: <b>{data.governance.taxonomyVersion}</b></li>
            <li>Golden validation: <b>{data.governance.goldenValidation.status}</b> — {data.governance.goldenValidation.summary}</li>
          </ul>
          <p className="decision-open-note">{data.governance.goldenValidation.detail}</p>
        </section>

        <section className="decision-section">
          <h3>Gap validation evidence <small>which validation project surfaced each known gap</small></h3>
          <div className="compact-table"><table><thead><tr><th>Area</th><th>Gap</th><th>Validation evidence</th></tr></thead><tbody>
            {data.governance.validationGaps.map((row, index) => <tr key={index}>
              <td><small>{row.area}</small></td>
              <td><b>{row.gap}</b></td>
              <td><small>{row.validationEvidence}</small></td>
            </tr>)}
          </tbody></table></div>
        </section>

        <section className="decision-section">
          <h3>Product Knowledge maturity</h3>
          <ul className="decision-requirement-list">
            <li>Modern structured attributes: <b>{data.products.withModernAttributes}</b> / {data.products.total}</li>
            <li>Legacy attributes only: <b>{data.products.withLegacyAttributesOnly}</b> / {data.products.total}</li>
            <li>Legacy standards recorded: <b>{data.products.withLegacyStandards}</b> · Modern certifications: <b>{data.products.withModernCertifications}</b></li>
            <li>Approved accessory/compatibility relationships: <b>{data.products.withApprovedAccessoryRelationship}</b> / {data.products.total}</li>
            <li>Lifecycle events recorded: <b>{data.products.withLifecycleEvents}</b> / {data.products.total}</li>
          </ul>
        </section>

        <section className="decision-section">
          <h3>Product roles <small>Classification only — does not affect product matching</small></h3>
          <ul className="decision-requirement-list">
            {data.productRoleDistribution.map((row) => <li key={row.role}><b>{row.role}</b>: {row.count}</li>)}
          </ul>
        </section>

        <section className="decision-section">
          <h3>Governance states</h3>
          <ul className="decision-requirement-list">
            {data.reviewStatusDistribution.map((row) => <li key={row.status}>Review status <b>{row.status}</b>: {row.count}</li>)}
            {data.lifecycleDistribution.map((row) => <li key={`lc-${row.status}`}>Lifecycle <b>{row.status}</b>: {row.count}</li>)}
          </ul>
          <p className="decision-open-note">
            Unknown lifecycle remains explicit until manufacturer evidence proves otherwise; it is never silently inferred as Active.
          </p>
        </section>
      </>}
    </>}
  </section>;
}
