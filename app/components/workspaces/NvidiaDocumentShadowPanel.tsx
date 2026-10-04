"use client";

// NVIDIA DOCUMENT INTELLIGENCE — SHADOW / SECOND_OPINION / NON_AUTHORITATIVE.
//
// Data-owning wrapper. `NvidiaDocumentShadowWorkspace` stays a PURE VIEW: it has
// no network access, no provider knowledge and no automatic effect, so this
// wrapper is the only place that talks to the route.
//
// GOVERNANCE
// ----------
// * The probe is never automatic. The status read on mount performs NO network
//   call to any provider, transmits nothing, and is the only automatic request.
// * Every probe submission is an explicit operator action and is refused by the
//   server unless the hosted-data gate is enabled AND the path sits inside the
//   server's trusted roots. A refusal is rendered as a refusal, never retried.
// * Nothing here writes. There is no DB write, and no path by which a shadow
//   result could reach a BOQ row, a match or a price.

import { useCallback, useEffect, useState } from "react";

import { requestJson } from "../../lib/api-client";
import NvidiaDocumentShadowWorkspace, {
  type ProbeResult,
  type ShadowStatus,
} from "./NvidiaDocumentShadowWorkspace";

const ROUTE = "/api/dev/nvidia-document-shadow";

// Fail-closed placeholder: if the status read has not succeeded, the view must
// not imply the probe is available.
const CLOSED_STATUS: ShadowStatus = {
  authority: {
    AUTHORITATIVE_PARSER: "—",
    NVIDIA_ROLE: "—",
    ESCALATION_POLICY: "—",
    LEADING_ROW_DECISION: "—",
  },
  credentialPresent: false,
  probeEnabled: false,
  trustedRoots: [],
  native: { status: "LOADING" },
  nvidia: { status: "NOT_RUN" },
  disclaimer: "Status unavailable. Treat the hosted probe as disabled.",
};

export function NvidiaDocumentShadowPanel() {
  const [status, setStatus] = useState<ShadowStatus>(CLOSED_STATUS);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    requestJson<ShadowStatus>(ROUTE, { method: "GET" })
      .then((payload) => {
        if (active) setStatus(payload);
      })
      .catch(() => {
        // Stay closed. A failed status read never enables anything.
        if (active) setStatus({ ...CLOSED_STATUS, native: { status: "UNAVAILABLE" } });
      });
    return () => {
      active = false;
    };
  }, []);

  const runProbe = useCallback(async (filePath: string) => {
    setProbing(true);
    setError("");
    try {
      const payload = await requestJson<ProbeResult>(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "probe",
          filePath,
          // Operator declaration only. The SERVER independently enforces the
          // trusted root allowlist, so this cannot widen what may be sent.
          payloadClassification: "AUTHORIZED_PROJECT_DOCUMENT",
        }),
      });
      setProbe(payload);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Request failed";
      setError(detail);
      setProbe({
        decision: "REQUEST_REFUSED",
        reason: detail,
        transmitted: false,
      });
    } finally {
      setProbing(false);
    }
  }, []);

  return (
    <>
      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800" role="status">
          {error}
        </p>
      ) : null}
      <NvidiaDocumentShadowWorkspace
        status={status}
        onRunProbe={runProbe}
        probe={probe}
        probing={probing}
      />
    </>
  );
}

export default NvidiaDocumentShadowPanel;