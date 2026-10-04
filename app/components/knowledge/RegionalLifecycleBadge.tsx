"use client";

// Regional lifecycle badge. Regions are shown separately; a single global
// Active/Discontinued is rendered ONLY when the evidence itself is global.
// Manufacturer lifecycle, regional catalog status, commercial availability and
// technical suitability are four different facts and are never merged.
export type RegionalLifecycle = {
  manufacturer?: string | null;
  global?: string | null;
  globalEvidence?: boolean;
  regions?: Array<{ region: string; status: string; successor?: string | null }>;
  commercialAvailability?: string | null;
  technicalSuitability?: string | null;
};

export function RegionalLifecycleBadge({ lifecycle }: { lifecycle: RegionalLifecycle }) {
  if (lifecycle.globalEvidence && lifecycle.global) {
    return <span className="lifecycle-badge lifecycle-global"><strong>{lifecycle.global}</strong><small>global evidence</small></span>;
  }
  const regions = lifecycle.regions || [];
  if (!regions.length) {
    return <span className="lifecycle-badge lifecycle-unknown"><strong>Unknown</strong><small>no regional evidence — not inferred</small></span>;
  }
  return <span className="lifecycle-badge lifecycle-regional">
    {regions.map((entry) => (
      <span key={entry.region}><strong>{entry.region}</strong>: {entry.status}{entry.successor ? ` → ${entry.successor}` : ""}</span>
    ))}
    {lifecycle.commercialAvailability && <small>Availability: {lifecycle.commercialAvailability}</small>}
    {lifecycle.technicalSuitability && <small>Suitability: {lifecycle.technicalSuitability}</small>}
  </span>;
}
