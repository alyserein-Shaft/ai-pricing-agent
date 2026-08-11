"use client";

import { useCallback, useEffect, useState } from "react";

type IntakeRow = {
  id: string;
  row_type: string;
  row_number: number;
  sheet_name?: string | null;
  supplier_name?: string | null;
  quotation_reference?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  part_number?: string | null;
  currency?: string | null;
  net_price_minor?: number | null;
  unit_price_minor?: number | null;
  issue_date?: string | null;
  valid_until?: string | null;
  product_id?: string | null;
  mapped_part_number?: string | null;
  mapping_basis?: string | null;
  review_status: string;
  document_id: string;
  document_version_id: string;
  eligibility?: { eligible: boolean; blockers: string[] };
};

type MappingCandidate = {
  productId: string;
  partNumber?: string;
  description?: string;
  manufacturer?: string;
  basis: string;
};

type ApiError = { error?: { message?: string; blockers?: string[] } };

export function SupplierPriceIntakeWorkspace({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MappingCandidate[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [reason, setReason] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/supplier-price-intake`, { cache: "no-store" });
      const body = await response.json() as { intake?: { rows?: IntakeRow[] } } & ApiError;
      if (!response.ok) throw new Error(body.error?.message || "Supplier quotation review could not be loaded.");
      setRows(body.intake?.rows || []);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openReview = async (row: IntakeRow) => {
    setSelectedRowId(row.id);
    setReason("");
    setReviewError("");
    setSelectedProductId(row.product_id || "");
    setCandidates([]);
    setReviewLoading(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/supplier-price-intake/${row.id}`, { cache: "no-store" });
      const body = await response.json() as { candidates?: MappingCandidate[] } & ApiError;
      if (!response.ok) throw new Error(body.error?.message || "Review details could not be loaded.");
      setCandidates(body.candidates || []);
    } catch (value) {
      setReviewError(value instanceof Error ? value.message : String(value));
    } finally {
      setReviewLoading(false);
    }
  };

  const act = async (action: "map" | "approve" | "reject" | "clarify") => {
    if (!selectedRowId || reason.trim().length < 3) {
      setReviewError("Enter a substantive review reason.");
      return;
    }
    if (action === "map" && !selectedProductId) {
      setReviewError("Select an exact canonical product before mapping.");
      return;
    }
    setReviewLoading(true);
    setReviewError("");
    const payload = action === "map" ? { reason: reason.trim(), productId: selectedProductId } : { reason: reason.trim() };
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/supplier-price-intake/${selectedRowId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        const blockers = body.error?.blockers?.length ? ` ${body.error.blockers.join(" · ")}` : "";
        throw new Error(`${body.error?.message || "Review failed."}${blockers}`);
      }
      await load();
      setReason("");
      if (action !== "map") setSelectedRowId(null);
    } catch (value) {
      setReviewError(value instanceof Error ? value.message : String(value));
    } finally {
      setReviewLoading(false);
    }
  };

  const selectedRow = rows.find(row => row.id === selectedRowId);
  const supplierLines = rows.filter(row => row.row_type === "SUPPLIER_LINE");

  return <section className="module-page supplier-price-intake-workspace" aria-label="Supplier quotation price review">
    <div className="module-heading"><div><small>GOVERNED SUPPLIER PRICE INTAKE</small><h2>Supplier quotation review</h2><p>Extracted lines remain review-only until an estimator maps the exact product and approves complete, current evidence for costing.</p></div><button onClick={() => void load()} disabled={loading}>Refresh</button></div>
    {loading ? <p>Loading persisted supplier lines…</p> : error ? <p className="managed-document-error">{error}</p> : !supplierLines.length ? <div className="empty-state"><strong>No extracted supplier quotation lines</strong><p>Upload and confirm an XLS, XLSX or CSV Supplier Quotation, then start extraction.</p></div> : <div className="persistent-review-list">{supplierLines.map(row => <article key={row.id}><header><div><small>{row.supplier_name || "Supplier not identified"} · {row.quotation_reference || "No quotation reference"}</small><strong>{row.description || row.part_number || `Line ${row.row_number}`}</strong></div><span className={row.eligibility?.eligible ? "review-ready" : "review-pending"}>{row.eligibility?.eligible ? "ELIGIBLE FOR COSTING" : row.review_status}</span></header><dl><div><dt>Source</dt><dd>{row.sheet_name || "Sheet"} · row {row.row_number}</dd></div><div><dt>Manufacturer / model</dt><dd>{row.manufacturer || "Missing"} · {row.part_number || "Missing"}</dd></div><div><dt>Extracted price</dt><dd>{row.currency || "Missing currency"} {((row.net_price_minor ?? row.unit_price_minor ?? 0) / 100).toFixed(2)}</dd></div><div><dt>Validity</dt><dd>{row.issue_date || "Missing issue date"} → {row.valid_until || "Missing validity"}</dd></div><div><dt>Mapped product</dt><dd>{row.mapped_part_number || "UNMAPPED"}</dd></div><div><dt>Mapping basis</dt><dd>{row.mapping_basis || "Needs review"}</dd></div></dl>{row.eligibility?.blockers?.length ? <p className="managed-document-error">{row.eligibility.blockers.join(" · ")}</p> : null}<footer><small>Source document {row.document_id} · version {row.document_version_id}</small><button className="secondary-action" onClick={() => void openReview(row)}>Review line</button></footer></article>)}</div>}
    {selectedRow ? <section className="review-panel" aria-label="Supplier line review controls">
      <div className="module-heading"><div><small>REVIEW LINE {selectedRow.row_number}</small><h3>{selectedRow.description || selectedRow.part_number}</h3></div><button className="secondary-action" onClick={() => setSelectedRowId(null)}>Close</button></div>
      <label>Exact canonical product<select value={selectedProductId} onChange={event => setSelectedProductId(event.target.value)} disabled={reviewLoading}><option value="">Select an exact candidate…</option>{candidates.map(candidate => <option key={candidate.productId} value={candidate.productId}>{candidate.partNumber || candidate.productId} · {candidate.manufacturer || "Manufacturer"} · {candidate.basis}</option>)}</select></label>
      {!reviewLoading && !candidates.length ? <p className="managed-document-error">No exact canonical model candidate is available. The line must remain unmapped.</p> : null}
      <label>Review reason<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain the evidence and decision." rows={3} /></label>
      {reviewError ? <p className="managed-document-error" role="alert">{reviewError}</p> : null}
      <div className="review-actions"><button className="secondary-action" disabled={reviewLoading || !selectedProductId} onClick={() => void act("map")}>{selectedRow.product_id ? "Change Mapping" : "Map Product"}</button><button className="secondary-action" disabled={reviewLoading} onClick={() => void act("clarify")}>Needs Clarification</button><button className="secondary-action" disabled={reviewLoading} onClick={() => void act("reject")}>Reject</button><button disabled={reviewLoading || !selectedRow.product_id || selectedRow.review_status === "Rejected"} onClick={() => void act("approve")}>Approve for Costing</button></div>
    </section> : null}
  </section>;
}
