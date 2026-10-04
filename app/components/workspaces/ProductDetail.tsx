"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

type AttributeRow = {
  attribute_name: string;
  normalized_value: string | null;
  original_value: string | null;
  unit: string | null;
  review_status: string;
  source_id: string | null;
  created_at: string | null;
};

type CertificationRow = {
  id: string;
  standard_body: string;
  standard_number: string | null;
  review_status: string;
};

type AccessoryRow = {
  product_accessory_id: string;
  related_product_part_number: string;
  review_status: string;
};

type EvidenceRow = {
  id: string;
  file_name: string;
  source_type: string;
  authority: string;
  validity_state: string;
  downstream_use: string;
  review_status: string;
  created_at: string | null;
};

type ProductDetailData = {
  identity: {
    part_number: string;
    name: string | null;
    family: string | null;
    manufacturer: string | null;
    brand: string | null;
    identity_status: string;
    superseded_by_product_id: string | null;
  };
  technical: {
    attributes: AttributeRow[];
    engineering_facts: any[]; // will be populated from knowledge facts
  };
  evidence: {
    sources: EvidenceRow[];
    product_source_evidence: any[]; // product_source_evidence rows
  };
  relationships: {
    accessories: AccessoryRow[];
    families: any[]; // product_families
    lifecycle: any[]; // product_lifecycle_events
  };
  certifications: CertificationRow[];
  commercial: {
    price_records: any[]; // price_records rows
    kpis: {
      normalized_price_records: number;
      global_pricing: number;
      project_specific_pricing: number;
      validity_end_missing: number;
      approval_status_approved: number;
    };
  };
  reviewSummary: {
    technicalFactsNeedsReview: number;
    totalFacts: number;
    evidenceSources: number;
    accessoriesNeedsReview: number;
    certificationsNeedsReview: number;
  };
};

export function ProductDetail() {
  const [productId, setProductId] = useState<string | null>(null);
  const [data, setData] = useState<ProductDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch product detail data from the API
  useEffect(() => {
    if (!productId) return;
    
    setLoading(true);
    setError("");
    
    fetch(`/api/products/${productId}?detail=true`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message || "Product detail could not be loaded.");
        }
        return response.json();
      })
      .then((json) => {
        setData(json);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Product detail could not be loaded.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [productId]);

  if (!productId) {
    return null;
  }

  if (loading) {
    return <LoadingState label="Loading product detail…"/>;
  }

  if (error) {
    return <ErrorState message={error}/>;
  }

  if (!data) {
    return <EmptyState title="No product detail" detail="Product not found."/>;
  }

  return (
    <section className="module-page product-detail-page">
      <div className="module-heading">
        <div>
          <small>KNOWLEDGE · PRODUCT DETAIL</small>
          <h1>Product Detail</h1>
        </div>
        <div className="product-header">
          <span className="product-part-number">{data.identity.part_number}</span>
          <span className="product-name">{data.identity.name || "—"}</span>
          <span className="product-meta">
            {data.identity.manufacturer || "—"}
            {data.identity.brand ? ` · ${data.identity.brand}` : ""}
          </span>
          <span className="product-family">{data.identity.family || "—"}</span>
        </div>
        <div className="health-indicators">
          <small>Status: 
            {data.identity.identity_status === "Active" && "Active" ||
             data.identity.identity_status === "Superseded" && "Superseded" ||
             data.identity.identity_status === "Blocked" && "Blocked" ||
             data.identity.identity_status}</small>
        </div>
        <button onClick={() => setProductId(null)} className="secondary-action">
          ← Back to Products
        </button>
      </div>

      <div className="product-detail-content">
        {/* Overview Section */}
        <div className="product-detail-section">
          <h2>Overview</h2>
          <div className="overview-grid">
            <div className="overview-field">
              <small>Part Number</small>
              <strong>{data.identity.part_number}</strong>
            </div>
            <div className="overview-field">
              <small>Product Name</small>
              <strong>{data.identity.name || "—"}</strong>
            </div>
            <div className="overview-field">
              <small>Family</small>
              <strong>{data.identity.family || "—"}</strong>
            </div>
            <div className="overview-field">
              <small>Manufacturer</small>
              <strong>{data.identity.manufacturer || "—"}</strong>
            </div>
            <div className="overview-field">
              <small>Brand</small>
              <strong>{data.identity.brand || "—"}</strong>
            </div>
            <div className="overview-field">
              <small>Identity Status</small>
              <span className={data.identity.identity_status === "Active" ? "badge-approved" : "badge-needs-review"}>
                {data.identity.identity_status}
              </span>
            </div>
          </div>
        </div>

        {/* Technical Knowledge Section */}
        <div className="product-detail-section">
          <h2>Technical Knowledge</h2>
          {data.technical.attributes.length > 0 ? (
            <div className="technical-attributes">
              {data.technical.attributes.map((attr, idx) => (
                <article key={idx}>
                  <div>
                    <strong>{attr.attribute_name}</strong>
                  </div>
                  <div>
                    <small>{attr.normalized_value || attr.original_value || "—"}</small>
                    {attr.unit && <span> {attr.unit}</span>}
                  </div>
                  <div>
                    <small>Review: {attr.review_status}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No technical attributes" detail="No product attributes found for this product."/>
          )}
        </div>

        {/* Evidence Section */}
        <div className="product-detail-section">
          <h2>Evidence & Sources</h2>
          {data.evidence.sources.length > 0 ? (
            <div className="evidence-sources">
              {data.evidence.sources.map((src, idx) => (
                <article key={idx}>
                  <div>
                    <small>{src.file_name}</small>
                  </div>
                  <div>
                    <small>Type: {src.source_type}</small>
                  </div>
                  <div>
                    <small>Authority: {src.authority}</small>
                  </div>
                  <div>
                    <small>Validity: {src.validity_state}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No evidence sources" detail="No source evidence found for this product."/>
          )}
        </div>

        {/* Relationships Section */}
        <div className="product-detail-section">
          <h2>Relationships</h2>
          <div className="relationships-grid">
            {/* Accessories */}
            {data.relationships.accessories.length > 0 ? (
              <div className="accessory-relationships">
                <small>Accessory Relationships</small>
                {data.relationships.accessories.map((acc, idx) => (
                  <article key={idx}>
                    <div>
                      <strong>{acc.related_product_part_number}</strong>
                    </div>
                    <div>
                      <small>Review: {acc.review_status}</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="accessory-relationships">
                <small>Accessory Relationships</small>
                <span>No governed accessory relationships available</span>
              </div>
            )}
            
            {/* Lifecycle */}
            {data.relationships.lifecycle.length > 0 ? (
              <div>
                <small>Lifecycle Events</small>
                {/* Simplified - would need more data */}
              </div>
            ) : (
              <span>No lifecycle events available</span>
            )}
          </div>
        </div>

        {/* Certifications Section */}
        <div className="product-detail-section">
          <h2>Certifications</h2>
          {data.certifications.length > 0 ? (
            <div className="certifications">
              {data.certifications.map((cert, idx) => (
                <article key={idx}>
                  <div>
                    <small>{cert.standard_body}</small>
                  </div>
                  <div>
                    <small>Status: {cert.review_status}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No certifications" detail="No certifications found for this product."/>
          )}
        </div>

        {/* Commercial Section (P0-D reuse) */}
        <div className="product-detail-section">
          <h2>Commercial</h2>
          {data.commercial.price_records.length > 0 ? (
            <div className="commercial-records">
              <small>Price Records: {data.commercial.price_records.length}</small>
              {/* Simplified - would show KPIs from P0-D */}
            </div>
          ) : (
            <EmptyState title="No pricing records" detail="No pricing records found for this product."/>
          )}
        </div>

        {/* Review & Gaps Summary */}
        <div className="product-detail-section">
          <h2>Review & Gaps</h2>
          <div className="review-summary">
            <small>Technical Facts</small>
            <strong>{data.reviewSummary.technicalFactsNeedsReview} of {data.reviewSummary.totalFacts} need review</strong>
          </div>
          <div className="review-summary">
            <small>Evidence Sources</small>
            <strong>{data.reviewSummary.evidenceSources} sources</strong>
          </div>
          <div className="review-summary">
            <small>Accessories</small>
            <strong>{data.reviewSummary.accessoriesNeedsReview} need review</strong>
          </div>
          <div className="review-summary">
            <small>Certifications</small>
            <strong>{data.reviewSummary.certificationsNeedsReview} need review</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
