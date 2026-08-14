"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";
import {
  resolveUnderstandingReviewSelection,
  shouldAcceptUnderstandingReviewDetail,
  understandingReviewIdentitiesMatch,
} from "../../domain/understanding-review-selection.mjs";

type Fact = { value: unknown; origin: "EXTRACTED" | "INFERRED" | "MISSING" | "NOT_APPLICABLE"; confidence: number };
type ReviewItem = {
  reviewKey: string; itemReference: string | null; description: string; quantity: number | string | null; unit: string | null;
  source: { sheet?: string; page?: number; row?: number; cells?: Record<string, string> };
  extractionReview: { status: string; confirmedForDownstream: boolean };
  ai: null | { status: string; qualityStatus: string; confidence: string; model: string; interpretedAt: string };
  review: { status: string; version: number; hasVersion: boolean; reason?: string | null; reviewedAt?: string | null };
  aiProposal: null | Record<string, any>;
  canonicalReview: null | { status: string; version: number; interpretation: null | Record<string, any>; changedFields: string[] };
  classification: null | Record<string, string | null>;
  reviewReasons: string[]; blockingMissingFields: string[]; informationalMissingFields: string[];
  classificationBlockers: Array<{ field: string; state: string; reason: string }>;
  matchingBlockers: Array<{ field: string; state: string; reason: string }>;
  laterProjectEvidenceNeeded: Array<{ field: string; state: string; reason: string }>;
  understandingApprovalEligible: boolean;
  discoveryReadiness: { state: string; eligible: boolean; label: string; missingConstraints: string[] };
  technicalMatchReadiness: { state: string; ready: boolean; label: string; reason?: string };
  provenanceSummary?: Record<string, number> | null;
  governedTaxonomy: { version: string | null; candidateAvailable: boolean; acceptedCandidate: boolean; category: string | null; productFamily: string | null };
  discovery: { eligible: boolean; label: string };
  proposalState: string; allowedActions: string[]; denialReasons: Record<string, string>; approvalDenialMessage: string | null; stateReason: string | null;
};
type Payload = { summary: Record<string, number>; currentRun: null | { model: string; runMode: string; status: string; startedAt: string; completedAt?: string }; items: ReviewItem[]; totalFiltered: number };
type Detail = ReviewItem & { selectionAuthority: string; authoritativeEvidence: { reviewKey: string; [key: string]: unknown }; interpretationHistory: Array<Record<string, any>>; reviewHistory: Array<Record<string, any>>; missingSpecificationChecklist: string[] };

const STATUS_FILTERS = ["All", "AWAITING_REVIEW", "APPROVED", "REJECTED", "FAILED"];
const CLASSIFICATION_FILTERS = ["All", "Missing essential classification", "Missing matching attributes", "Governed Fire Alarm", "Exploratory systems"];
const FIELD_LABELS: Record<string, string> = { equipmentType: "Equipment type", productFamily: "Product family" };
const label = (value: string) => {
  const field = value.replace(/^attributes\./, "");
  return FIELD_LABELS[field] || field.replaceAll("_", " ").toLowerCase().replace(/^./, (char) => char.toUpperCase());
};
const fact = (value: unknown): value is Fact => Boolean(value && typeof value === "object" && "origin" in value);

export function AiUnderstandingReviewWorkspace({ projectId }: { projectId: string }) {
  const initial = () => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [status, setStatus] = useState(() => initial().get("reviewStatus") || "All");
  const [classification, setClassification] = useState(() => initial().get("understandingFilter") || "All");
  const [search, setSearch] = useState(() => initial().get("q") || "");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedKey, setSelectedKey] = useState(() => initial().get("reviewItem") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [selectionChanged, setSelectionChanged] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const syncUrl = useCallback((next: { status?: string; classification?: string; search?: string; selectedKey?: string }, replace = false) => {
    const query = new URLSearchParams(window.location.search);
    const values = { status, classification, search, selectedKey, ...next };
    values.status === "All" ? query.delete("reviewStatus") : query.set("reviewStatus", values.status);
    values.classification === "All" ? query.delete("understandingFilter") : query.set("understandingFilter", values.classification);
    values.search ? query.set("q", values.search) : query.delete("q");
    values.selectedKey ? query.set("reviewItem", values.selectedKey) : query.delete("reviewItem");
    window.history[replace ? "replaceState" : "pushState"](null, "", `?${query.toString()}`);
  }, [classification, search, selectedKey, status]);

  const load = useCallback(async () => {
    const requestNumber = ++listRequest.current;
    setLoading(true); setError(""); setPayload(null); setDetail(null); setEditing(false); setSelectionChanged(false);
    try {
      const query = new URLSearchParams();
      if (status !== "All") query.set("status", status);
      if (classification !== "All") query.set("classification", classification);
      if (search.trim()) query.set("q", search.trim());
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/estimator-understanding-review?${query}`, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message || "AI Understanding Review could not be loaded.");
      if (requestNumber === listRequest.current) setPayload(value);
    } catch (caught) { if (requestNumber === listRequest.current) setError(caught instanceof Error ? caught.message : "AI Understanding Review could not be loaded."); }
    finally { if (requestNumber === listRequest.current) setLoading(false); }
  }, [classification, projectId, search, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onPop = () => { const query = new URLSearchParams(window.location.search); setStatus(query.get("reviewStatus") || "All"); setClassification(query.get("understandingFilter") || "All"); setSearch(query.get("q") || ""); setSelectedKey(query.get("reviewItem") || ""); };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!payload) return;
    const resolvedKey = resolveUnderstandingReviewSelection(payload.items, selectedKey);
    if (resolvedKey === selectedKey) return;
    detailRequest.current += 1;
    setDetail(null); setEditing(false); setSelectionChanged(false); setSelectedKey(resolvedKey);
    syncUrl({ selectedKey: resolvedKey }, true);
  }, [payload, selectedKey, syncUrl]);
  useEffect(() => {
    const selectedQueueItem = payload?.items.find((item) => item.reviewKey === selectedKey) || null;
    if (!selectedKey || !selectedQueueItem) { setDetail(null); return; }
    const requestNumber = ++detailRequest.current;
    const requestedKey = selectedKey;
    setDetail(null); setEditing(false); setSelectionChanged(false);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/estimator-understanding-review/items/${encodeURIComponent(selectedKey)}`, { cache: "no-store" })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value?.error?.message || "Review detail could not be loaded."); return value; })
      .then((value) => {
        if (requestNumber !== detailRequest.current) return;
        if (!shouldAcceptUnderstandingReviewDetail(requestedKey, selectedKey, selectedQueueItem, value)) { setSelectionChanged(true); return; }
        const draftSource = value.canonicalReview?.interpretation || value.aiProposal;
        setDetail(value); setDraft({
          ...Object.fromEntries(["system", "category", "equipmentType", "productFamily", "subcategory"].map((key) => [key, String(draftSource?.[key]?.value || "")])),
          ...Object.fromEntries(Object.entries(draftSource?.attributes || {}).map(([key, value]: [string, any]) => [`attributes.${key}`, String(value?.value || "")])),
        })
      })
      .catch((caught) => { if (requestNumber === detailRequest.current) setError(caught instanceof Error ? caught.message : "Review detail could not be loaded."); });
  }, [payload, projectId, selectedKey]);

  const selectedQueueItem = payload?.items.find((item) => item.reviewKey === selectedKey) || null;
  const identitiesAligned = understandingReviewIdentitiesMatch(selectedKey, selectedQueueItem, detail);
  const select = (item: ReviewItem) => { detailRequest.current += 1; setDetail(null); setEditing(false); setSelectionChanged(false); setSelectedKey(item.reviewKey); syncUrl({ selectedKey: item.reviewKey }); };
  const action = async (operation: string) => {
    if (!detail || submitting || !identitiesAligned) { setError("Selection changed — reload the current item"); return; }
    if (!detail.allowedActions.includes(operation)) { setError(detail.approvalDenialMessage || "This action is not available for the current authoritative state."); return; }
    const mutationTarget = { reviewKey: detail.reviewKey, expectedVersion: detail.review.version, selectionAuthority: detail.selectionAuthority };
    let reason: string | null = null;
    if (["EDIT_AND_APPROVE", "REJECT_INTERPRETATION", "RETURN_TO_REVIEW"].includes(operation)) {
      reason = window.prompt("Review reason (required)")?.trim() || null;
      if (!reason) return;
    }
    const canonicalInterpretation = operation === "EDIT_AND_APPROVE" ? (() => {
      const source = detail.canonicalReview?.interpretation || detail.aiProposal;
      return {
        ...source,
        ...Object.fromEntries(Object.entries(draft).filter(([key]) => !key.startsWith("attributes.")).map(([key, value]) => [key, { value: value || null, origin: value ? "INFERRED" : "MISSING", confidence: value ? 70 : 0 }])),
        attributes: {
          ...(source?.attributes || {}),
          ...Object.fromEntries(Object.entries(draft).filter(([key]) => key.startsWith("attributes.")).map(([key, value]) => [key.slice("attributes.".length), { value: value || null, origin: value ? "INFERRED" : "MISSING", confidence: value ? 70 : 0 }])),
        },
      };
    })() : undefined;
    setSubmitting(true); setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/estimator-understanding-review/items/${encodeURIComponent(mutationTarget.reviewKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: operation, expectedVersion: mutationTarget.expectedVersion, selectionAuthority: mutationTarget.selectionAuthority, requestId: `review:${crypto.randomUUID()}`, reason, ...(canonicalInterpretation ? { canonicalInterpretation } : {}) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message || "Review decision could not be saved.");
      await load();
      setEditing(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review decision could not be saved."); }
    finally { setSubmitting(false); }
  };

  const summary = payload?.summary || {};
  const summaryCards = useMemo(() => [
    ["Current BOQ", summary.authoritativeCurrentBoqItems], ["AI attempted", summary.aiAttempted], ["Awaiting review", summary.awaitingReview],
    ["Approved", summary.approved], ["Rejected", summary.rejected], ["Failed", summary.failed], ["Not analyzed", summary.notAnalyzed],
  ], [summary]);

  return <section className="module-page understanding-review-workspace">
    <header className="module-heading"><div><small>TENDER · ENGINEER AUTHORITY</small><h1>AI Understanding Review</h1><p>Review AI interpretations separately from extraction confirmation. Approval enables product discovery only.</p></div><span className="review-pending">No bulk approval</span></header>
    <div className="understanding-review-summary">{summaryCards.map(([name, value]) => <article key={String(name)}><span>{name}</span><strong>{Number(value || 0)}</strong></article>)}</div>
    <aside className="understanding-authority-note"><strong>Two independent reviews</strong><span>Extraction confirmed: {summary.extractionConfirmed || 0} · extraction pending: {summary.extractionNeedsReview || 0}</span><span>AI model: {payload?.currentRun?.model || "No run"} · {payload?.currentRun?.runMode ? label(payload.currentRun.runMode) : "Not analyzed"}</span></aside>
    <div className="understanding-review-filters">
      <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); syncUrl({ status: event.target.value }); }}>{STATUS_FILTERS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Evidence filter<select value={classification} onChange={(event) => { setClassification(event.target.value); syncUrl({ classification: event.target.value }); }}>{CLASSIFICATION_FILTERS.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Search<input value={search} onChange={(event) => { setSearch(event.target.value); syncUrl({ search: event.target.value }, true); }} placeholder="Item reference or description"/></label>
    </div>
    {error && <ErrorState message={error}/>} {loading && <LoadingState label="Loading current authoritative BOQ understanding…"/>}
    {!loading && payload && <div className="understanding-review-layout">
      <section className="understanding-review-queue"><header><strong>{payload.totalFiltered} current items</strong><small>Compact review queue</small></header>
        {payload.items.map((item) => <button key={item.reviewKey} className={selectedKey === item.reviewKey ? "selected" : ""} onClick={() => select(item)}>
          <span><strong>{item.itemReference || "No reference"} · {item.description}</strong><small>{item.quantity ?? "—"} {item.unit || ""} · {item.source.sheet || `Page ${item.source.page || "—"}`} {item.source.row ? `· row ${item.source.row}` : ""}</small><small>{item.classification?.system || "System missing"} · {item.classification?.category || "Category missing"} · {item.classification?.productFamily || "Family missing"}</small></span>
          <span><b className={item.review.status === "APPROVED" ? "review-ready" : item.review.status === "FAILED" || item.review.status === "REJECTED" ? "review-blocked" : "review-pending"}>{label(item.review.status)}</b><small>{item.ai?.confidence || "Not analyzed"}</small></span>
          <span className="understanding-reasons">{item.reviewReasons.slice(0, 2).map((reason) => <small key={reason}>{label(reason)}</small>)}{item.classificationBlockers.length > 0 && <small>{item.classificationBlockers.length} classification blockers</small>}{item.matchingBlockers.length > 0 && <small>{item.matchingBlockers.length} matching fields needed later</small>}</span>
        </button>)}
        {!payload.items.length && <EmptyState title="No current BOQ items match these filters" detail="Change the status, evidence filter, or search term."/>}
      </section>
      <section className="understanding-review-detail">{detail && identitiesAligned ? <>
        <header><div><small>{detail.itemReference || "BOQ ITEM"}</small><h2>{detail.description}</h2><p>{detail.quantity ?? "—"} {detail.unit || ""} · {detail.source.sheet || "Source sheet unavailable"} {detail.source.row ? `row ${detail.source.row}` : ""}</p></div><span className={detail.review.status === "APPROVED" ? "review-ready" : "review-pending"}>{label(detail.review.status)}</span></header>
        <section className="understanding-evidence"><strong>Original authoritative BOQ evidence</strong><p>{detail.description}</p><small>Extraction review: {detail.extractionReview.status} · AI understanding: {detail.ai?.qualityStatus || "Not analyzed"}</small></section>
        <section><strong>AI proposed classification</strong><div className="understanding-fact-grid">{["system", "category", "equipmentType", "productFamily", "subcategory"].map((key) => { const value = detail.aiProposal?.[key]; return <article key={key}><small>{label(key)}</small><strong>{value?.value || "Missing"}</strong><span className={`origin-${String(value?.origin || "MISSING").toLowerCase()}`}>{value?.origin || "MISSING"} · {value?.confidence || 0}%</span></article>; })}</div><small>The proposal is review evidence only and has not been promoted to engineer authority.</small></section>
        <section><strong>Engineer-reviewed canonical classification</strong>{editing ? <><small>Unsaved review draft — no review version is created until submission.</small><div className="understanding-fact-grid">{["system", "category", "equipmentType", "productFamily", "subcategory"].map((key) => <article key={key}><small>{label(key)}</small><input value={draft[key] || ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}/>{(draft[key] || "") !== String(detail.aiProposal?.[key]?.value || "") && <span>Changed from AI proposal</span>}</article>)}</div></> : detail.canonicalReview?.interpretation ? <><small>{detail.canonicalReview.status === "APPROVED" ? "Approved canonical version" : "Canonical review version"} · v{detail.canonicalReview.version}</small><div className="understanding-fact-grid">{["system", "category", "equipmentType", "productFamily", "subcategory"].map((key) => { const value = detail.canonicalReview?.interpretation?.[key]; return <article key={key}><small>{label(key)}</small><strong>{value?.value || "Missing"}</strong><span className={`origin-${String(value?.origin || "MISSING").toLowerCase()}`}>{value?.origin || "MISSING"} · {value?.confidence || 0}%</span>{detail.canonicalReview?.changedFields.includes(key) && <span>Changed from AI proposal</span>}</article>; })}</div></> : <p>No engineer-reviewed canonical version yet.</p>}</section>
        <section><strong>Governed taxonomy constraint</strong><p>{detail.governedTaxonomy.acceptedCandidate ? `${detail.governedTaxonomy.category} / ${detail.governedTaxonomy.productFamily} was accepted through the governed candidate contract.` : detail.governedTaxonomy.candidateAvailable ? "A governed candidate existed but was not validly accepted." : "No governed Fire Alarm candidate applies."}</p><small>{detail.governedTaxonomy.version || "No taxonomy version"}</small></section>
        <section><strong>AI proposed technical attributes</strong><div className="understanding-attributes">{Object.entries(detail.aiProposal?.attributes || {}).map(([name, value]) => fact(value) && <article key={name}><b>{label(name)}</b><span>{String(value.value ?? "Missing")}</span><small>{value.origin} · {value.confidence}%</small></article>)}</div></section>
        <section className="understanding-missing">
          <div><strong>Classification blockers</strong>{detail.classificationBlockers.length ? detail.classificationBlockers.map((entry) => <span key={entry.field}>{label(entry.field)} · {label(entry.state)}</span>) : <span>Classification complete</span>}</div>
          <div><strong>Later project evidence needed</strong>{detail.laterProjectEvidenceNeeded.length ? detail.laterProjectEvidenceNeeded.map((entry) => <span key={entry.field}>{label(entry.field)} · {label(entry.state)}</span>) : <span>None identified</span>}</div>
          <div><strong>Technical matching blockers</strong>{detail.matchingBlockers.length ? detail.matchingBlockers.map((entry) => <span key={entry.field}>{label(entry.field)} · {entry.reason}</span>) : <span>Required matching evidence is present</span>}</div>
          <div><strong>Informational missing</strong>{detail.informationalMissingFields.length ? detail.informationalMissingFields.map((value) => <span key={value}>{label(value)}</span>) : <span>None</span>}</div>
        </section>
        <section className="understanding-readiness"><article><strong>Discovery readiness</strong><p>{detail.discoveryReadiness.label}</p><small>Candidate results remain Discovery Only and create no product, technical, price, or quotation approval.</small></article><article><strong>Technical match readiness</strong><p>{detail.technicalMatchReadiness.label}</p><small>{detail.technicalMatchReadiness.reason || "Engineer technical review remains required."}</small></article></section>
        <details><summary>Provenance and immutable history</summary><p>Provenance: {Object.entries(detail.provenanceSummary || {}).map(([key, value]) => `${key} ${value}`).join(" · ") || "Unavailable"}</p>{detail.interpretationHistory.map((entry) => <article key={entry.version}><strong>AI interpretation v{entry.version} · {entry.status}</strong><small>{entry.runMode}{entry.hasParentRun ? " · controlled child run" : " · original run"} · {entry.model} · {entry.usage.durationMs ?? "—"} ms · sanitized usage only</small></article>)}{detail.reviewHistory.map((entry, index) => <article key={`${entry.createdAt}-${index}`}><strong>{label(entry.action)}</strong><p>{entry.reason || "No reason supplied"}</p><small>{entry.createdAt}</small></article>)}</details>
        <div className="preview-actions">
          {detail.review.status === "AWAITING_REVIEW" && <button disabled={submitting || !detail.allowedActions.includes("APPROVE_INTERPRETATION")} title={detail.approvalDenialMessage || undefined} onClick={() => void action("APPROVE_INTERPRETATION")}>Approve interpretation</button>}
          {detail.allowedActions.includes("EDIT_AND_APPROVE") && <button disabled={submitting} onClick={() => editing ? void action("EDIT_AND_APPROVE") : setEditing(true)}>{editing ? "Save edit and approve" : "Edit and approve"}</button>}
          {detail.allowedActions.includes("REJECT_INTERPRETATION") && <button disabled={submitting} onClick={() => void action("REJECT_INTERPRETATION")}>Reject interpretation</button>}
          {detail.allowedActions.includes("RETURN_TO_REVIEW") && <button disabled={submitting} onClick={() => void action("RETURN_TO_REVIEW")}>Return to review</button>}
          {detail.approvalDenialMessage && detail.review.status === "AWAITING_REVIEW" && <span className="review-action-denial" role="status">{detail.approvalDenialMessage}</span>}
          {detail.review.status === "FAILED" && <button disabled title="Retry requires a separately authorized retry manifest">Retry failed item — governed flow required</button>}
        </div>
        <aside className="understanding-discovery-state"><strong>{detail.discovery.label}</strong><p>This decision does not approve a product, technical compliance, price, or quotation and does not start matching.</p></aside>
      </> : selectionChanged ? <ErrorState message="Selection changed — reload the current item"/> : selectedKey ? <LoadingState label="Loading the selected current BOQ item…"/> : <EmptyState title="No current BOQ item selected" detail="Change the filters or search to select a current authoritative item."/>}</section>
    </div>}
  </section>;
}
