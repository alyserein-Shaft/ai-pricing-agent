"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

type SizingSnapshot = {
  id: string;
  version: number;
  status: string;
  engineVersion: string;
  reason: string;
  createdAt: string;
  calculation: Record<string, unknown>;
  dossier: Record<string, unknown>;
  input: Record<string, unknown>;
};

const renderValue = (value: unknown): string => {
  if (value === null || value === undefined) return "Unknown";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function Section({ title, entries }: { title: string; entries: Array<[string, unknown]> }) {
  if (!entries.length) return null;
  return <div className="sizing-section">
    <h3>{title}</h3>
    <dl>{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{renderValue(value)}</dd></div>)}</dl>
  </div>;
}

export function SizingWorkspace({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<SizingSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/fire-alarm/preliminary-sizing/current`, { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json();
        if (response.status === 404) { if (active) setMissing(true); return null; }
        if (!response.ok) throw new Error(value?.error?.message || "The sizing snapshot could not be loaded.");
        return value.snapshot;
      })
      .then((value) => { if (active && value) setSnapshot(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "The sizing snapshot could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  if (loading) return <section className="module-page sizing-page"><LoadingState label="Loading sizing evidence…" /></section>;
  if (error) return <section className="module-page sizing-page"><ErrorState message={error} /></section>;
  if (missing || !snapshot) {
    return <section className="module-page sizing-page">
      <div className="module-heading"><div><small>ENGINEERING · SIZING</small><h1>Sizing</h1></div></div>
      <EmptyState title="No sizing snapshot yet" detail="Point demand has not been sized for this project. Sizing appears here once demand is governed — it never blocks pricing, but pricing without it is explicit." />
    </section>;
  }

  const calc = Object.entries(snapshot.calculation || {});
  const input = Object.entries(snapshot.input || {});
  const dossier = Object.entries(snapshot.dossier || {});
  const looksFinal = !/preliminary|assumption|unknown/i.test(JSON.stringify(snapshot));

  return <section className="module-page sizing-page">
    <div className="module-heading">
      <div>
        <small>ENGINEERING · SIZING</small>
        <h1>Sizing</h1>
        <p>Preliminary demand and capacity from governed evidence. A preliminary allocation is an assumption, never final detailed design.</p>
      </div>
    </div>
    <div className="sizing-result">
      <small>RESULT · v{snapshot.version} · {snapshot.engineVersion}</small>
      <strong>{snapshot.status}</strong>
      {!looksFinal && <span className="sizing-preliminary">Preliminary — subject to revision after detailed design</span>}
    </div>
    <Section title="Demand" entries={calc} />
    <Section title="Inputs" entries={input} />
    <Section title="Evidence" entries={dossier} />
    <details className="sizing-advanced">
      <summary>Advanced calculation internals</summary>
      <dl>
        <div><dt>Snapshot id</dt><dd>{snapshot.id}</dd></div>
        <div><dt>Reason</dt><dd>{snapshot.reason}</dd></div>
        <div><dt>Created</dt><dd>{snapshot.createdAt}</dd></div>
      </dl>
    </details>
  </section>;
}
