"use client";

import { useState } from "react";
import { ErrorState } from "../shared/WorkspaceStates";
import { MAX_GOVERNED_REASON_LENGTH, MIN_GOVERNED_REASON_LENGTH, reviewDecisionLabel } from "../../domain/review-reason-gate.mjs";

// Governed reason form for engineer review decisions.
//
// Replaces a window.prompt and is the ONLY path by which a review mutation is
// issued: the parent never passes a default reason, and this form refuses to
// hand back a reason that is blank or shorter than the canonical governed
// minimum. Cancelling calls onCancel and performs no request at all.
export function ReasonForm({ title, decision, initialError, onSubmit, onCancel, busy }: {
  title: string;
  decision: string;
  initialError?: string;
  onSubmit: (reason: string, source: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState(initialError || "");

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) { setError("A substantive reason is required for this decision. No decision was recorded."); return; }
    if (trimmed.length < MIN_GOVERNED_REASON_LENGTH) { setError(`The reason must be at least ${MIN_GOVERNED_REASON_LENGTH} characters. No decision was recorded.`); return; }
    onSubmit(trimmed.slice(0, MAX_GOVERNED_REASON_LENGTH), source.trim());
  };

  return <div className="reason-form" role="dialog" aria-label={title}>
    <header><strong>{title}</strong><small>Decision: {reviewDecisionLabel(decision)}</small></header>
    <label>Reason (required, minimum {MIN_GOVERNED_REASON_LENGTH} characters)
      <textarea value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} placeholder="Engineering reason for this decision" />
    </label>
    <label>Source / evidence context (optional)
      <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="e.g. spec seq 100052, drawing p.19" />
    </label>
    {error && <ErrorState message={error} />}
    <footer>
      <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" onClick={submit} disabled={busy}>{busy ? "Recording…" : "Record decision"}</button>
    </footer>
  </div>;
}
