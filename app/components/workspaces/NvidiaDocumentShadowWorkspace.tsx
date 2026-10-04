"use client";

// NVIDIA DOCUMENT INTELLIGENCE — SHADOW WORKSPACE (advisory only).
//
// This panel DISPLAYS shadow-benchmark facts and, on explicit operator action,
// runs a single on-demand probe. It deliberately contains no logic that could
// influence extraction, matching, or commercial output:
//
//   * there is no automatic probe — nothing runs unless an operator clicks;
//   * no NVIDIA value is ever written back into a BOQ row, a match or a price;
//   * every NVIDIA result is rendered as `shadow` / advisory;
//   * refusals from the privacy guard are shown as refusals, not retried.
//
// The component receives data and callbacks as props so it stays a pure view and
// carries no provider, model or credential knowledge — those live server-side.

export type ShadowAuthority = {
  AUTHORITATIVE_PARSER: string;
  NVIDIA_ROLE: string;
  ESCALATION_POLICY: string;
  LEADING_ROW_DECISION: string;
};

export type ComponentSummary = {
  model: string;
  role: string;
  status: number;
  ok: boolean;
  detections: number;
  classes: string[];
  textDetections: number;
  latencyMs: number;
  errorClass: string | null;
  /** Diagnostic metadata the provider already returns; may be absent. */
  confidence?: number | null;
};

export type ShadowStatus = {
  authority: ShadowAuthority;
  credentialPresent: boolean;
  /** Hosted-data gate. Absent on older payloads; treated as OFF (fail-closed). */
  probeEnabled?: boolean;
  trustedRoots?: string[];
  native: { status: string; passRate?: number; p0?: number; p1?: number; failingCases?: string[] };
  nvidia: { status: string; reason?: string; fixedFailures?: number; controlRegressions?: number };
  disclaimer: string;
};

export type ProbeResult = {
  decision: string;
  reason?: string;
  transmitted: boolean;
  authority?: ShadowAuthority;
  bytesSent?: number;
  reconciliation?: { componentCount: number; componentsSucceeded: number; note: string };
  components?: ComponentSummary[];
  native?: unknown;
  disclaimer?: string;
};

const ROLE_LABEL: Record<string, string> = {
  text: "Text (OCR)",
  regions: "Regions / layout",
  geometry: "Table geometry",
};

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    ok: "bg-emerald-100 text-emerald-800 border-emerald-300",
    warn: "bg-amber-100 text-amber-900 border-amber-300",
    bad: "bg-red-100 text-red-800 border-red-300",
    muted: "bg-slate-100 text-slate-700 border-slate-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function NvidiaDocumentShadowWorkspace({
  status,
  onRunProbe,
  probe,
  probing,
}: {
  status: ShadowStatus;
  onRunProbe: (filePath: string) => void;
  probe: ProbeResult | null;
  probing: boolean;
}) {
  // Fail-closed presentation: an absent flag is treated as DISABLED.
  const probeEnabled = status.probeEnabled === true;
  return (
    <section className="space-y-4 p-4" aria-label="NVIDIA document intelligence shadow status">
      {/* Authority banner — stated first, and never implied otherwise. */}
      <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
        <p className="mb-2 text-sm font-semibold text-slate-800">
          Advisory second opinion — does not modify canonical project truth.
        </p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pill tone="muted">Authoritative parser: {status.authority.AUTHORITATIVE_PARSER}</Pill>
          <Pill tone="warn">NVIDIA role: {status.authority.NVIDIA_ROLE}</Pill>
          <Pill tone="muted">Escalation: {status.authority.ESCALATION_POLICY}</Pill>
          <Pill tone={probeEnabled ? "warn" : "bad"}>
            Hosted probe: {probeEnabled ? "ENABLED by operator" : "DISABLED — nothing is transmitted"}
          </Pill>
          <Pill tone={status.credentialPresent ? "ok" : "muted"}>
            Credential: {status.credentialPresent ? "configured (server-side)" : "not configured"}
          </Pill>
        </div>
        <p className="text-sm text-slate-700">{status.disclaimer}</p>
        <p className="mt-1 text-xs text-slate-600">
          Leading merged row above a recognised header → <strong>{status.authority.LEADING_ROW_DECISION}</strong>
        </p>
        {status.trustedRoots?.length ? (
          <p className="mt-1 text-xs text-slate-600">
            Permitted transmission roots (server-side only):{" "}
            <span className="font-mono">{status.trustedRoots.join(", ")}</span>
          </p>
        ) : null}
      </div>

      {/* Measured comparison */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <h3 className="mb-1 text-sm font-semibold">Native parser</h3>
          <p className="text-xs text-slate-600">Sole extraction authority.</p>
          {status.native.passRate !== undefined ? (
            <p className="mt-2 text-sm">
              <Pill tone={status.native.p0 === 0 ? "ok" : "bad"}>
                pass {Math.round((status.native.passRate ?? 0) * 100)}%
              </Pill>{" "}
              <Pill tone={(status.native.p0 ?? 0) === 0 ? "ok" : "bad"}>P0 {status.native.p0}</Pill>{" "}
              <Pill tone="warn">P1 {status.native.p1}</Pill>
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">{status.native.status}</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <h3 className="mb-1 text-sm font-semibold">NVIDIA shadow</h3>
          <p className="text-xs text-slate-600">Advisory comparison only.</p>
          {status.nvidia.fixedFailures !== undefined ? (
            <p className="mt-2 text-sm">
              <Pill tone={status.nvidia.fixedFailures > 0 ? "ok" : "muted"}>
                fixed {status.nvidia.fixedFailures}
              </Pill>{" "}
              <Pill tone={(status.nvidia.controlRegressions ?? 0) > 0 ? "bad" : "ok"}>
                control regressions {status.nvidia.controlRegressions}
              </Pill>
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">{status.nvidia.reason ?? status.nvidia.status}</p>
          )}
        </div>
      </div>

      {/* On-demand probe. Never automatic. */}
      <div className="rounded-lg border border-slate-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">On-demand probe</h3>
        <p className="mb-2 text-xs text-slate-600">
          Runs one live comparison for a single approved, already-rendered image. Nothing is sent until you
          submit, project/private paths are refused by the server, and no result is ever written back.
        </p>
        {probeEnabled ? (
          <ProbeForm onRun={onRunProbe} busy={probing} />
        ) : (
          <p className="rounded border border-slate-300 bg-slate-100 p-2 text-xs text-slate-600">
            Hosted probe disabled for this deployment. Submitting is unavailable and no document can leave
            this system, because hosted-data terms are unresolved. Only synthetic, server-approved roots are
            permitted even once an operator enables it.
          </p>
        )}
        {probe ? <ProbeReport probe={probe} /> : null}
      </div>
    </section>
  );
}

function ProbeForm({ onRun, busy }: { onRun: (filePath: string) => void; busy: boolean }) {
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const value = new FormData(e.currentTarget).get("filePath");
        if (typeof value === "string" && value.trim()) onRun(value.trim());
      }}
    >
      <input
        name="filePath"
        placeholder="approved/render.png"
        className="min-w-[16rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        aria-label="Approved image path to probe"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-slate-800 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Probing…" : "Run single probe"}
      </button>
    </form>
  );
}

function ProbeReport({ probe }: { probe: ProbeResult }) {
  const refused = !probe.transmitted;
  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill tone={refused ? "bad" : "ok"}>{probe.decision}</Pill>
        {probe.bytesSent ? <Pill tone="muted">{(probe.bytesSent / 1024).toFixed(0)} KB sent</Pill> : null}
      </div>
      {probe.reason ? <p className="mb-2 text-xs text-slate-700">{probe.reason}</p> : null}

      {probe.components?.length ? (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1">Responsibility</th>
              <th>Model</th>
              <th>Status</th>
              <th>Detections</th>
              <th>Confidence</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {probe.components.map((c) => (
              <tr key={`${c.role}-${c.model}`} className="border-t border-slate-200">
                <td className="py-1">{ROLE_LABEL[c.role] ?? c.role}</td>
                <td className="font-mono text-[10px]">{c.model}</td>
                <td>
                  {c.ok ? <Pill tone="ok">ok</Pill> : <Pill tone="bad">{c.errorClass ?? c.status}</Pill>}
                </td>
                <td>{c.detections}</td>
                <td>{typeof c.confidence === "number" ? c.confidence.toFixed(3) : "—"}</td>
                <td>{c.latencyMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {probe.reconciliation ? (
        <p className="mt-2 text-[11px] text-slate-600">
          {probe.reconciliation.componentsSucceeded}/{probe.reconciliation.componentCount} components responded.{" "}
          {probe.reconciliation.note}
        </p>
      ) : null}
      {probe.disclaimer ? <p className="mt-1 text-[11px] text-slate-500">{probe.disclaimer}</p> : null}
    </div>
  );
}
