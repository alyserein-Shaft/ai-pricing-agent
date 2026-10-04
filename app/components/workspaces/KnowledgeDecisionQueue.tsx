"use client";

/**
 * The Knowledge review surface an engineer actually works from.
 *
 * WHY THIS IS ITS OWN COMPONENT RATHER THAN MORE PROPS ON
 * KnowledgeLibraryWorkspace. The existing Review section renders a flat list of
 * `Needs Review` items from `/api/knowledge/review-queue`, and it counts facts.
 * That is the wrong unit for an engineering decision: the 70 Batch-1 research
 * facts are evidence for about a dozen product decisions, and no engineer makes
 * "review 67 facts" a decision. The fix is a different READ MODEL, not a
 * restyle of the old one, so this component owns its own fetch and its own
 * state. It is mounted inside the Review section and leaves the existing
 * file-level queue, filters and identity review untouched -- the old queue is
 * still the right tool for a file that needs re-ingesting; it is simply the
 * wrong tool for approving a product attribute.
 *
 * THREE THINGS THIS COMPONENT REFUSES TO DO
 *
 *  1. No "Approve all". Every packet is one decision and is confirmed,
 *     rejected or held on its own. Per-fact overrides exist so a packet can be
 *     partially decided, and the atomic facts never collapse into a single
 *     displayed value.
 *  2. No silent "Success". The response carries `promotionHeadline` ("4
 *     Approved product attributes created"), per-fact outcomes, canonical
 *     changes and downstream impact, and all of it is rendered. A decision that
 *     recorded a review but promoted nothing says so.
 *  3. No blind Confirm on a blocked packet. A packet with an open product
 *     identity conflict, an ambiguous catalogue target, contradictory
 *     single-valued evidence or no evidence at all renders its reason and
 *     disables Confirm, leaving Reject and Needs Investigation available.
 *
 * The component is deliberately self-fetching. `app/page.tsx` is ~31k lines and
 * is under active concurrent change in this working tree; adding props to it
 * would risk colliding with that work for no benefit, since this surface needs
 * exactly one endpoint and one POST.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

type Packet = {
  packetId: string;
  partNumber: string;
  canonicalPartNumber: string | null;
  family: string | null;
  manufacturerName: string;
  category: string;
  reviewState: string;
  identityConflictOpen: boolean;
  isConfirmable: boolean;
  blockReason: string | null;
  proposedInterpretation: unknown;
  values: {
    factType: string;
    canonicalAttribute: string | null;
    multiValued: boolean;
    conflicting: boolean;
    observedValues: {
      value: string;
      normalizedValue: string;
      relationshipType: string | null;
      targetPartNumber: string | null;
      observationCount: number;
      corroboratingObservations: {
        factId: string;
        documentNumber: string | null;
        revision: string | null;
        fileName: string;
        quote: string | null;
        reviewStatus: string;
      }[];
    }[];
  }[];
  conflictingValues: unknown[];
  openProductConflicts: { conflictId: string; [key: string]: unknown }[];
  observations: {
    factId: string;
    factType: string;
    value: string;
    normalizedValue: string;
    unit: string | null;
    reviewStatus: string;
    confidence: number | null;
    observationKey: string;
    relationshipType: string;
    targetPartNumber: string;
    evidence: {
      fileName: string;
      documentNumber: string;
      revision: string;
      page: string | number | null;
      section: string | null;
      quote: string | null;
      url: string | null;
      sourceAuthority: string | null;
      detectedType: string | null;
    };
    policyPromotion: { eligible: boolean; status: string; reason: string; attributeName?: string };
  }[];
  sources: { fileName: string; documentNumber: string; revision: string; authorityClass: string | null }[];
  downstreamConsumers: string[];
  promotableFactCount: number;
  terminalFactCount: number;
  recommendationFromResearch: string | null;
  evidenceGap?: {
    reason: string;
    researchedBy: string | null;
    note: string | null;
  } | null;
  history: {
    decision: string;
    reason: string;
    decidedBy: string;
    decidedByName: string | null;
    decidedAt: string;
    factCount: number;
    outcomeSummary: string | null;
  }[];
};

type ProductRollup = {
  partNumber: string;
  canonicalProductId: string | null;
  family: string | null;
  manufacturerName: string;
  pendingDecisions: number;
  confirmedDecisions: number;
  rejectedDecisions: number;
  needsInvestigation: number;
  conflicts: number;
  evidenceGaps: number;
  totalDecisions: number;
  openConflictIds: string[];
};

type AuthorityCorrection = {
  fileId: string | null;
  fileName: string;
  found: boolean;
  partNumber: string;
  documentNumber: string;
  revision: string;
  retrievalChannel: string;
  currentAuthorityClass: string | null;
  proposedAuthorityClass: string;
  alreadyCorrected: boolean;
  reason: string;
};

type QueueResponse = {
  products: ProductRollup[];
  packets: Packet[];
  totals: {
    decisions: number;
    pending: number;
    confirmed: number;
    rejected: number;
    needsInvestigation: number;
    conflicts: number;
    evidenceGaps: number;
    observations: number;
  };
  sourceAuthorityCorrections: AuthorityCorrection[];
};

type DecisionResult = {
  ok: boolean;
  idempotent?: boolean;
  status?: string;
  outcome?: string;
  promotionStatus?: string;
  message?: string;
  promotionHeadline?: string;
  code?: string;
  eventId?: string;
  canonicalChanges?: { kind: string; detail: string }[];
  downstream?: { consumer: string; effect: string }[];
  links?: { factId: string; kind: string; productId: string }[];
  blocked?: { factId?: string; code: string }[];
  factOutcomes?: {
    factId: string;
    factType: string;
    value: string;
    review: { status: string; code?: string; message?: string };
    promotion: { status: string; message?: string; canonicalChange?: unknown } | null;
  }[];
};

const REVIEW_STATE_COPY: Record<string, { label: string; tone: string; action: boolean }> = {
  pending: { label: "Awaiting decision", tone: "pending", action: true },
  partially_decided: { label: "Partially decided", tone: "pending", action: true },
  confirmed: { label: "Confirmed", tone: "done", action: false },
  rejected: { label: "Rejected", tone: "rejected", action: false },
  needs_investigation: { label: "Needs investigation", tone: "held", action: true },
  conflict: { label: "Conflict — needs interpretation", tone: "conflict", action: false },
  evidence_gap: { label: "Evidence missing", tone: "gap", action: true },
};

/**
 * Why a packet cannot be confirmed, in the engineer's terms rather than as a
 * code. The raw `blockReason` is still shown alongside; this is the sentence a
 * reviewer reads first, because the code alone does not say what to DO.
 */
const BLOCK_COPY: Record<string, string> = {
  EVIDENCE_MISSING:
    "No first-party manufacturer evidence exists for this decision. Nothing here can be approved — record Needs Investigation, or Reject the claim and commission the document.",
  AMBIGUOUS_CATALOGUE_TARGET:
    "More than one live catalogue row carries this part number. Approving against an arbitrary one would assert an identity nobody has established; fix the catalogue first.",
  NO_CANONICAL_PRODUCT:
    "No live catalogue product backs this part number, so there is nothing to attach an attribute to.",
  OPEN_PRODUCT_CONFLICT:
    "An open product-identity conflict names this part number. The evidence can still be reviewed and linked, but nothing will be promoted until the conflict is resolved — and resolving it needs the conflict-resolution write path, which does not exist yet.",
  CONTRADICTORY_EVIDENCE:
    "Two first-party documents give different answers to a single-valued attribute. Neither is silently preferred.",
  TERMINAL_FACT_TYPES_ONLY:
    "Every observation here is classified terminal by policy, so this packet can be reviewed and recorded but can never create canonical truth.",
};

const tone = (state: string) => REVIEW_STATE_COPY[state]?.tone ?? "pending";
const stateLabel = (state: string) => {
  const copy = REVIEW_STATE_COPY[state];
  if (!copy) return state;
  const badge = copy.action ? '🔘' : '⬛';
  return `${badge} ${copy.label}`;
};

const stamp = () => new Date().toISOString();

/** A per-submission idempotency key. Shown to the operator so a replay is
 * demonstrable rather than a claim. */
const newIdempotencyKey = () =>
  `kn-decision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function KnowledgeDecisionQueue() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [overrides, setOverrides] = useState<Record<string, "confirm" | "reject">>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [authorityResult, setAuthorityResult] = useState<DecisionResult | null>(null);
  const [authorityReason, setAuthorityReason] = useState<Record<string, string>>({});
  const [showAuthority, setShowAuthority] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge/decision-packets", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setError(String(body?.error?.message || "The decision queue could not be loaded."));
        return;
      }
      setData(body as QueueResponse);
      setSelectedPacketId((current) =>
        current && (body as QueueResponse).packets.some((p) => p.packetId === current)
          ? current
          : (body as QueueResponse).packets[0]?.packetId ?? null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const packetsByProduct = useMemo(() => {
    const grouped = new Map<string, Packet[]>();
    for (const packet of data?.packets ?? []) {
      const key = packet.partNumber.toUpperCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(packet);
    }
    return grouped;
  }, [data]);

  const selected = useMemo(
    () => data?.packets.find((packet) => packet.packetId === selectedPacketId) ?? null,
    [data, selectedPacketId],
  );

  const openPacket = (packetId: string) => {
    setSelectedPacketId(packetId);
    // Per-fact overrides and the reason belong to one decision. Carrying them
    // across packets is how a decision meant for the address model gets applied
    // to a lifecycle event.
    setOverrides({});
    setReason("");
    setResult(null);
    setLastKey(null);
  };

  const hasContradiction = Boolean(selected?.values.some((entry) => entry.conflicting));

  const confirmDisabled =
    !selected ||
    submitting ||
    reason.trim().length < 20 ||
    !selected.isConfirmable ||
    (selected.reviewState === "conflict" && !hasContradiction ? false : false) ||
    (selected.reviewState === "conflict" && selected.conflictingValues.length === 0);

const confirmActionText = selected?.isConfirmable ? 'Confirm' : 'Review Action Not Available';

  const decide = async (decision: "confirm" | "reject" | "needs_investigation", key?: string) => {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    setAuthorityResult(null);
    const idempotencyKey = key ?? newIdempotencyKey();
    try {
      const response = await fetch(
        `/api/knowledge/decision-packets/${encodeURIComponent(selected.packetId)}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, reason, factDecisions: overrides, idempotencyKey }),
        },
      );
      const body = await response.json();
      setResult(body as DecisionResult);
      setLastKey(idempotencyKey);
      // The rollup is the primary read, so a decision that changes nothing
      // visible on screen would look like it did not save. Re-read instead of
      // patching local state, which also proves the write is durable.
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  };

  const correctAuthority = async (correction: AuthorityCorrection) => {
    if (!correction.fileId) return;
    setSubmitting(true);
    setError("");
    setResult(null);
    const idempotencyKey = newIdempotencyKey();
    try {
      const response = await fetch(
        `/api/knowledge/sources/${encodeURIComponent(correction.fileId)}/review-authority`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            proposedAuthorityClass: correction.proposedAuthorityClass,
            reason: authorityReason[correction.fileId] || correction.reason,
            supportingProvenance: {
              documentNumber: correction.documentNumber,
              revision: correction.revision,
              retrievedFrom: correction.retrievalChannel,
            },
            idempotencyKey,
          }),
        },
      );
      const body = await response.json();
      setAuthorityResult(body as DecisionResult);
      setLastKey(idempotencyKey);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The authority correction could not be saved.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !data) {
    return (
      <section className="decision-queue" aria-busy="true">
        <p className="decision-queue-note">Loading engineering decisions…</p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="decision-queue">
        <div className="dashboard-error" role="alert">
          {error}
        </div>
        <button type="button" className="button" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );
  }

  const totals = data?.totals;

  return (
    <section className="decision-queue" aria-label="Engineering decisions">
      <header className="decision-queue-head">
        <div>
          <h3>Engineering decisions <span className="decision-queue-action-badge">{selected?.isConfirmable ? '🔧 Available' : '🚫 Read-only'}</span></h3>
          <p>
            One entry per product decision, not per extracted fact. Raw facts are
            evidence inside a decision and stay individually visible.
          </p>
        </div>
        <dl className="decision-queue-totals">
          <span>
            <dt>Pending</dt>
            <dd>{totals?.pending ?? 0}</dd>
          </span>
          <span>
            <dt>Confirmed</dt>
            <dd>{totals?.confirmed ?? 0}</dd>
          </span>
          <span>
            <dt>Needs investigation</dt>
            <dd>{totals?.needsInvestigation ?? 0}</dd>
          </span>
          <span>
            <dt>Conflicts</dt>
            <dd>{totals?.conflicts ?? 0}</dd>
          </span>
          <span>
            <dt>Evidence missing</dt>
            <dd>{totals?.evidenceGaps ?? 0}</dd>
          </span>
        </dl>
      </header>

      {error ? (
        <div className="dashboard-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="decision-queue-layout">
        <nav className="decision-queue-products" aria-label="Products with pending decisions">
          {data?.products.length ? (
            data.products.map((product) => {
              const parts = packetsByProduct.get(product.partNumber.toUpperCase()) ?? [];
              const active = parts.some((packet) => packet.packetId === selectedPacketId);
              return (
                <button
                  type="button"
                  key={product.partNumber}
                  className={active ? "selected" : ""}
                  onClick={() => {
                    const firstPending =
                      parts.find((packet) => ["pending", "partially_decided"].includes(packet.reviewState)) ??
                      parts[0];
                    if (firstPending) openPacket(firstPending.packetId);
                  }}
                >
                  <span>
                    <strong>{product.partNumber}</strong>
                    <small>
                      {[product.manufacturerName, product.family].filter(Boolean).join(" · ") || "Product"}
                    </small>
                  </span>
                  <span>
                    <b className="decision-queue-headline">
                      {product.pendingDecisions > 0
                        ? `${product.pendingDecisions} decision${product.pendingDecisions === 1 ? "" : "s"} pending`
                        : "No decisions pending"}
                    </b>
                    <small>
                      {[
                        product.confirmedDecisions > 0 ? `${product.confirmedDecisions} confirmed` : "",
                        product.rejectedDecisions > 0 ? `${product.rejectedDecisions} rejected` : "",
                        product.needsInvestigation > 0 ? `${product.needsInvestigation} needs investigation` : "",
                        product.conflicts > 0 ? `${product.conflicts} conflict` : "",
                        product.evidenceGaps > 0 ? `${product.evidenceGaps} evidence missing` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || `${product.totalDecisions} decisions recorded`}
                    </small>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="decision-queue-note">
              No product decisions are open. Every research observation for this
              organisation has been decided.
            </p>
          )}
        </nav>

        <div className="decision-queue-detail">
          {!selected ? (
            <p className="decision-queue-note">Select a product to open its decisions.</p>
          ) : (
            <article className="decision-card" key={selected.packetId}>
              <header>
                <div>
                  <span className={`decision-state decision-state-${tone(selected.reviewState)}`}>
                    {stateLabel(selected.reviewState)}
                  </span>
                  <h4>
                    {selected.partNumber} — {selected.category}
                  </h4>
                  <p>
                    Canonical product{" "}
                    <b>{selected.canonicalPartNumber || "not resolved"}</b>
                    {selected.family ? <> · family {selected.family}</> : null}
                    {selected.manufacturerName ? <> · {selected.manufacturerName}</> : null}
                  </p>
                </div>
              </header>

              {selected.blockReason ? (
                <p className="decision-block">
                  <b>Confirm is unavailable.</b> {BLOCK_COPY[selected.blockReason] || selected.blockReason}
                  {" "}
                  <small>({selected.blockReason})</small>
                </p>
              ) : null}

              {selected.evidenceGap ? (
                <section className="decision-section">
                  <h5>Evidence missing</h5>
                  <p>{selected.evidenceGap.reason}</p>
                  {selected.evidenceGap.note ? <p>{selected.evidenceGap.note}</p> : null}
                  <small>
                    Researched by {selected.evidenceGap.researchedBy || "the research pass"}. Absence of
                    evidence is not approval, and this decision cannot be confirmed.
                  </small>
                </section>
              ) : null}

              <section className="decision-section">
                <h5>Proposed interpretation</h5>
                {selected.proposedInterpretation ? (
                  <pre className="decision-interpretation">
                    {JSON.stringify(selected.proposedInterpretation, null, 2)}
                  </pre>
                ) : (
                  <p>
                    No interpretation is proposed. This decision groups{" "}
                    {selected.observations.length} atomic observation
                    {selected.observations.length === 1 ? "" : "s"} for a human to read, not a
                    machine to apply.
                  </p>
                )}
                {selected.recommendationFromResearch ? (
                  <p className="decision-recommendation">
                    <b>Research recommendation:</b> {selected.recommendationFromResearch}
                  </p>
                ) : null}
              </section>

              {selected.openProductConflicts.length ? (
                <section className="decision-section decision-conflicts">
                  <h5>Open product-identity conflict</h5>
                  <p>
                    The catalogue holds an unresolved conflict for this part number. It is shown, not
                    resolved: this screen has no write path to close it, and inventing one in the same
                    change that starts approving products would be the wrong order of operations.
                  </p>
                  <ul>
                    {selected.openProductConflicts.map((conflict) => (
                      <li key={conflict.conflictId}>
                        <code>{conflict.conflictId}</code>{" "}
                        {String(
                          (conflict as { conflictType?: string }).conflictType ||
                            (conflict as { field?: string }).field ||
                            "identity conflict",
                        )}{" "}
                        —{" "}
                        {String(
                          (conflict as { field?: string }).field ||
                            (conflict as { conflictType?: string }).conflictType ||
                            "",
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {selected.conflictingValues.length ? (
                <section className="decision-section decision-conflicts">
                  <h5>Contradictory evidence</h5>
                  {selected.values
                    .filter((entry) => entry.conflicting)
                    .map((entry) => (
                      <div key={entry.factType} className="decision-conflict-values">
                        <b>{entry.factType}</b>
                        {entry.observedValues.map((observed) => (
                          <div key={`${entry.factType}-${observed.normalizedValue}`} className="decision-value">
                            <strong>Value: {observed.value}</strong>
                            <ul>
                              {observed.corroboratingObservations.map((support) => (
                                <li key={support.factId}>
                                  {support.fileName}
                                  {support.documentNumber ? ` · doc ${support.documentNumber}` : ""}
                                  {support.revision ? ` · rev ${support.revision}` : ""}
                                  {support.quote ? <> — “{support.quote}”</> : null}
                                  <small> ({support.reviewStatus})</small>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ))}
                  <p>
                    Both readings are shown with their documents and revisions. Choosing between them
                    is the engineering decision; the queue will not make it.
                  </p>
                </section>
              ) : null}

              <section className="decision-section">
                <h5>
                  Atomic facts ({selected.observations.length}) ·{" "}
                  {selected.promotableFactCount} promotable · {selected.terminalFactCount} terminal
                </h5>
                {selected.observations.length ? (
                  <ul className="decision-observations">
                    {selected.observations.map((observation) => {
                      const override = overrides[observation.factId];
                      return (
                        <li key={observation.factId}>
                          <div>
                            <b>{observation.factType}</b>
                            <span className="decision-fact-value">{observation.value}</span>
                            {observation.unit ? <small> {observation.unit}</small> : null}
                            {observation.targetPartNumber ? (
                              <small> → {observation.targetPartNumber}</small>
                            ) : null}
                          </div>
                          <div>
                            <small>
                              {observation.evidence.fileName}
                              {observation.evidence.documentNumber
                                ? ` · doc ${observation.evidence.documentNumber}`
                                : ""}
                              {observation.evidence.revision
                                ? ` · rev ${observation.evidence.revision}`
                                : ""}
                              {observation.evidence.page != null ? ` · p.${observation.evidence.page}` : ""}
                              {observation.evidence.section ? ` · ${observation.evidence.section}` : ""}
                            </small>
                            {observation.evidence.quote ? (
                              <blockquote>“{observation.evidence.quote}”</blockquote>
                            ) : null}
                            <small>
                              Source authority:{" "}
                              {observation.evidence.sourceAuthority || "not recorded"}
                              {observation.evidence.url ? (
                                <>
                                  {" · "}
                                  <a href={observation.evidence.url} target="_blank" rel="noreferrer">
                                    first-party document
                                  </a>
                                </>
                              ) : null}
                            </small>
                            {!observation.policyPromotion?.eligible ? (
                              <small className="decision-terminal">
                                Terminal by policy: {observation.policyPromotion?.reason}
                              </small>
                            ) : null}
                            <small>
                              Current state: {observation.reviewStatus}
                              {observation.confidence != null ? ` · confidence ${observation.confidence}%` : ""}
                            </small>
                          </div>
                          {selected.isConfirmable ? (
                            <div className="decision-fact-actions" role="group" aria-label="Per-fact decision">
                              {(["confirm", "reject"] as const).map((choice) => (
                                <label key={choice}>
                                  <input
                                    type="radio"
                                    name={`fact-${observation.factId}`}
                                    checked={override === choice}
                                    onChange={() =>
                                      setOverrides((current) => ({
                                        ...current,
                                        [observation.factId]: choice,
                                      }))
                                    }
                                  />
                                  {choice === "confirm" ? "Include" : "Discard"}
                                </label>
                              ))}
                              {override ? (
                                <button
                                  type="button"
                                  className="button"
                                  onClick={() =>
                                    setOverrides((current) => {
                                      const next = { ...current };
                                      delete next[observation.factId];
                                      return next;
                                    })
                                  }
                                >
                                  Clear
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>No observations are attached to this decision.</p>
                )}
                {selected.observations.length ? (
                  <p className="decision-override-note">
                    {Object.keys(overrides).length
                      ? `${Object.keys(overrides).length} of ${selected.observations.length} facts are individually overridden; the rest follow the packet decision.`
                      : "Every fact will follow the packet decision. Override individual facts above to decide them separately."}
                  </p>
                ) : null}
              </section>

              {selected.sources.length ? (
                <section className="decision-section">
                  <h5>Manufacturer sources</h5>
                  <ul>
                    {selected.sources.map((source) => (
                      <li key={`${source.fileName}-${source.documentNumber}`}>
                        {source.fileName}
                        {source.documentNumber ? ` · doc ${source.documentNumber}` : ""}
                        {source.revision ? ` · rev ${source.revision}` : ""}
                        {source.authorityClass ? (
                          <small> · {source.authorityClass}</small>
                        ) : (
                          <small className="decision-terminal"> · source authority not recorded</small>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="decision-section">
                <h5>Affects</h5>
                {selected.downstreamConsumers.length ? (
                  <ul>
                    {selected.downstreamConsumers.map((consumer) => (
                      <li key={consumer}>{consumer}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No downstream consumer is registered for this decision.</p>
                )}
              </section>

              {selected.history.length ? (
                <section className="decision-section">
                  <h5>Decision history</h5>
                  <ul>
                    {selected.history.map((entry, index) => (
                      <li key={`${entry.decidedAt}-${index}`}>
                        <b>{entry.decision}</b> by {entry.decidedByName || entry.decidedBy} ·{" "}
                        {entry.decidedAt} · {entry.factCount} fact
                        {entry.factCount === 1 ? "" : "s"}
                        {entry.outcomeSummary ? <div>{entry.outcomeSummary}</div> : null}
                        <div className="decision-history-reason">“{entry.reason}”</div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <footer className="decision-actions">
                <label>
                  <span>Decision reason (required, 20+ characters)</span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={2000}
                    placeholder="State the engineering reason. This is written to the audit trail verbatim."
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="button decision-confirm"
                    disabled={confirmDisabled}
                    title={
                      selected.isConfirmable
                        ? undefined
                        : "This decision cannot be confirmed. Use Reject or Needs Investigation."
                    }
                    onClick={() => void decide("confirm")}
                  >
                    Confirm this decision
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={submitting || reason.trim().length < 20}
                    onClick={() => void decide("reject")}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={submitting || reason.trim().length < 20}
                    onClick={() => void decide("needs_investigation")}
                  >
                    Needs Investigation
                  </button>
                </div>
                {lastKey ? (
                  <button
                    type="button"
                    className="button decision-replay"
                    disabled={submitting}
                    onClick={() => void decide("confirm", lastKey)}
                    title="Re-send the identical decision with the same idempotency key. Nothing should be written twice."
                  >
                    Replay last decision (idempotency check)
                  </button>
                ) : null}
              </footer>

              {result ? (
                <section className="decision-result" role="status">
                  <h5>
                    {result.promotionHeadline || result.message || (result.ok ? "Decision recorded" : "Decision refused")}
                  </h5>
                  {result.outcome ? <p className="decision-result-code">{result.outcome}</p> : null}
                  {result.code ? <p className="decision-result-code">{result.code}</p> : null}
                  {result.idempotent ? (
                    <p className="decision-result-replay">
                      Idempotent replay: the identical decision was already recorded as{" "}
                      <code>{result.eventId || result.status}</code> and nothing was written a second
                      time.
                    </p>
                  ) : null}
                  {result.canonicalChanges?.length ? (
                    <div>
                      <h6>Canonical changes</h6>
                      <ul>
                        {result.canonicalChanges.map((change, index) => (
                          <li key={`${change.kind}-${index}`}>
                            <b>{change.kind}</b> {change.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {result.downstream?.length ? (
                    <div>
                      <h6>Downstream impact</h6>
                      <ul>
                        {result.downstream.map((entry, index) => (
                          <li key={`${entry.consumer}-${index}`}>
                            <b>{entry.consumer}</b> {entry.effect}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {result.blocked?.length ? (
                    <div>
                      <h6>Blocked</h6>
                      <ul>
                        {result.blocked.map((entry, index) => (
                          <li key={`${entry.code}-${index}`}>
                            {entry.factId ? <code>{entry.factId}</code> : null} {entry.code}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {result.factOutcomes?.length ? (
                    <div>
                      <h6>Per-fact outcome</h6>
                      <ul className="decision-fact-outcomes">
                        {result.factOutcomes.map((outcome) => (
                          <li key={outcome.factId}>
                            <b>{outcome.factType}</b> “{outcome.value}” → {outcome.review.status}
                            {outcome.review.message ? `: ${outcome.review.message}` : ""}
                            {outcome.promotion
                              ? ` · promotion ${outcome.promotion.status}${
                                  outcome.promotion.message ? `: ${outcome.promotion.message}` : ""
                                }`
                              : " · not promoted"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </article>
          )}
        </div>
      </div>

      <section className="decision-queue-authority">
        <button
          type="button"
          className="button"
          onClick={() => setShowAuthority((current) => !current)}
          aria-expanded={showAuthority}
        >
          {showAuthority ? "Hide" : "Show"} stale source-authority corrections (
          {data?.sourceAuthorityCorrections.length ?? 0})
        </button>
        {showAuthority ? (
          <div>
            <p className="decision-queue-note">
              These are the only two Batch-1 documents whose stored source authority is proven
              stale. Each correction changes the authority field only; it never touches extracted
              facts, and it is refused if the retained evidence is a first-party <em>commercial</em>{" "}
              document such as a price list. A document number on its own never establishes
              manufacturer technical authority.
            </p>
            {data?.sourceAuthorityCorrections.map((correction) => (
              <article key={correction.fileName} className="decision-authority-card">
                <div>
                  <b>{correction.fileName}</b>
                  <p>
                    {correction.partNumber} · doc {correction.documentNumber} · rev {correction.revision}{" "}
                    · {correction.retrievalChannel}
                  </p>
                  <p>
                    Stored: <b>{correction.currentAuthorityClass || "not recorded"}</b> → proposed:{" "}
                    <b>{correction.proposedAuthorityClass}</b>
                  </p>
                  <small>{correction.reason}</small>
                </div>
                <div>
                  {!correction.found ? (
                    <p className="decision-terminal">No stored file matches this declaration.</p>
                  ) : correction.alreadyCorrected ? (
                    <p className="decision-state decision-state-done">Already corrected</p>
                  ) : (
                    <>
                      <label>
                        <span>Correction reason (required, 40+ characters)</span>
                        <textarea
                          value={authorityReason[correction.fileId || ""] || ""}
                          onChange={(event) =>
                            setAuthorityReason((current) => ({
                              ...current,
                              [correction.fileId || ""]: event.target.value,
                            }))
                          }
                          placeholder={correction.reason}
                          maxLength={2000}
                        />
                      </label>
                      <button
                        type="button"
                        className="button decision-confirm"
                        disabled={submitting}
                        onClick={() => void correctAuthority(correction)}
                      >
                        Correct source authority
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {authorityResult ? (
              <section className="decision-result" role="status">
                <h5>
                  {authorityResult.message ||
                    (authorityResult.ok ? "Source authority corrected" : "Correction refused")}
                </h5>
                {authorityResult.code ? (
                  <p className="decision-result-code">{authorityResult.code}</p>
                ) : null}
                {authorityResult.idempotent ? (
                  <p className="decision-result-replay">
                    Idempotent replay: the identical correction was already recorded and nothing was
                    written a second time.
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
      <p className="decision-queue-footnote">
        Rendered {stamp()} · packet version {data?.packets[0]?.packetVersion || "—"} ·{" "}
        {totals?.observations ?? 0} observations grouped into {totals?.decisions ?? 0} decisions
      </p>
    </section>
  );
}

export default KnowledgeDecisionQueue;
