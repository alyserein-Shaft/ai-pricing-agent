"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

type StrategyEvidence = {
  policyVersion: string;
  policyId: string;
  project: { id: string; name: string };
  evidence: { ecosystem: unknown; demandSnapshot: { status: string } | null };
};

type StrategyDecision = {
  version: string;
  preferredBrand: string;
  decidedByStep: number;
  decidedBy: string;
  brandRelationship?: string;
  commercialWorkflow?: string;
  standardsRegime?: string;
  addressablePointCount?: number;
  rationale?: string;
  evidence?: string[];
  alternativeBrandStatus?: unknown;
};

export function StrategyWorkspace({ projectId }: { projectId: string }) {
  const [evidence, setEvidence] = useState<StrategyEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mandatoryBrand, setMandatoryBrand] = useState("");
  const [mandatoryEvidence, setMandatoryEvidence] = useState("");
  const [regime, setRegime] = useState<"ULF" | "EN">("ULF");
  const [points, setPoints] = useState("");
  const [basis, setBasis] = useState("governed point-demand snapshot");
  const [decision, setDecision] = useState<StrategyDecision | null>(null);
  const [resolveError, setResolveError] = useState("");
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/fire-alarm/brand-strategy`, { cache: "no-store" })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value?.error?.message || "The brand strategy evidence could not be loaded."); return value; })
      .then((value) => { if (active) setEvidence(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "The brand strategy evidence could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  if (loading) return <section className="module-page strategy-page"><LoadingState label="Loading brand strategy evidence…" /></section>;
  if (error) return <section className="module-page strategy-page"><ErrorState message={error} /></section>;
  if (!evidence) return <section className="module-page strategy-page"><EmptyState title="No strategy evidence" detail="The project could not be found." /></section>;

  const resolve = async () => {
    setResolving(true); setResolveError(""); setDecision(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/fire-alarm/brand-strategy/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemCategory: "FIRE_ALARM",
          mandatoryBrand: mandatoryBrand.trim() || null,
          mandatoryBrandEvidence: mandatoryEvidence.split("\n").map((line) => line.trim()).filter(Boolean),
          standardsRegime: regime,
          addressablePointCount: Number(points),
          pointCountBasis: basis.trim(),
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message || "The strategy could not be resolved.");
      setDecision(value.decision);
    } catch (caught) {
      setResolveError(caught instanceof Error ? caught.message : "The strategy could not be resolved.");
    } finally {
      setResolving(false);
    }
  };

  return <section className="module-page strategy-page">
    <div className="module-heading">
      <div>
        <small>STRATEGY · BRAND / TECHNICAL</small>
        <h1>Brand &amp; Technical Strategy</h1>
        <p>Company brand policy runs before product matching. Confirm the four inputs below, then resolve. Nothing here selects products or approves a design.</p>
      </div>
    </div>

    <div className="strategy-policy-note">
      <strong>In-house brands:</strong> Farenhyt (UL/FM, ≤2000 system points) · Gamewell (UL/FM, &gt;2000) · Gent by Honeywell (EN).
      A contractually mandatory brand overrides all — a manufacturer merely named in a spec is <em>not</em> a mandate.
      NOTIFIER stays a technically valid alternative, never auto-preferred.
    </div>

    <div className="strategy-inputs">
      <label>Mandatory Client/Consultant brand (leave empty when none contractually mandated)
        <input value={mandatoryBrand} onChange={(event) => setMandatoryBrand(event.target.value)} placeholder="e.g. NOTIFIER — only with evidence below" />
      </label>
      <label>Mandate evidence (one requirement reference per line — required when a brand is named)
        <textarea value={mandatoryEvidence} onChange={(event) => setMandatoryEvidence(event.target.value)} placeholder={"seq 100509 — manufacturer shall be…"} />
      </label>
      <label>Standards regime
        <select value={regime} onChange={(event) => setRegime(event.target.value === "EN" ? "EN" : "ULF")}>
          <option value="ULF">UL / FM</option>
          <option value="EN">EN (European)</option>
        </select>
      </label>
      <label>Addressable system points{evidence.evidence.demandSnapshot ? ` (demand snapshot: ${evidence.evidence.demandSnapshot.status})` : " (no demand snapshot yet)"}
        <input value={points} onChange={(event) => setPoints(event.target.value)} inputMode="numeric" placeholder="e.g. 1877" />
      </label>
      <label>Point-count basis
        <input value={basis} onChange={(event) => setBasis(event.target.value)} />
      </label>
      <button onClick={resolve} disabled={resolving}>{resolving ? "Resolving…" : "Resolve preferred brand"}</button>
    </div>
    {resolveError && <ErrorState message={resolveError} />}

    {decision && <div className="strategy-decision">
      <div className="strategy-hero">
        <small>CURRENT STRATEGY</small>
        <strong>{decision.preferredBrand}</strong>
        <span>decided by step {decision.decidedByStep} — {decision.decidedBy}</span>
      </div>
      {decision.rationale && <p>{decision.rationale}</p>}
      <dl>
        {decision.brandRelationship && <><dt>Commercial relationship</dt><dd>{decision.brandRelationship}</dd></>}
        {decision.commercialWorkflow && <><dt>Commercial workflow</dt><dd>{decision.commercialWorkflow}</dd></>}
        {typeof decision.addressablePointCount === "number" && <><dt>System points</dt><dd>{decision.addressablePointCount}</dd></>}
      </dl>
      <p className="strategy-note">NOTIFIER technical work is preserved as benchmark/alternative regardless of this outcome. This decision is not persisted — recording a project strategy decision remains a governed follow-up.</p>
    </div>}
  </section>;
}
