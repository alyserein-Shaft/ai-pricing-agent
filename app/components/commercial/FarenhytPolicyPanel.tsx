"use client";

import { useEffect, useState } from "react";
import { farenhytPolicyModel, applyFarenhytNet, currencyDisplay } from "../../domain/commercial-line-presentation.mjs";
import { ErrorState, LoadingState } from "../shared/WorkspaceStates";

type RuleRow = {
  id?: string;
  discount_basis_points?: number;
  approval_state?: string;
  superseded_at?: string | null;
};

export function FarenhytPolicyPanel({ brandName, listAmount, listCurrency }: {
  brandName?: string;
  listAmount?: number | null;
  listCurrency?: string;
}) {
  const [rule, setRule] = useState<RuleRow | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/pricing/discount-rules/effective?brand_name=${encodeURIComponent(brandName || "Farenhyt")}`, { cache: "no-store" })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value?.message || value?.error?.message || "Policy check unavailable"); return value; })
      .then((value) => { if (active) { setRule(value && value.rule ? value.rule : null); setChecked(true); } })
      .catch((caught) => { if (active) { setError(caught instanceof Error ? caught.message : "Policy check unavailable"); setChecked(true); } });
    return () => { active = false; };
  }, [brandName]);
  if (error) return <div className="farenhyt-policy"><ErrorState message={error} /></div>;
  if (!checked) return <div className="farenhyt-policy"><LoadingState label="Checking governed pricing policy…" /></div>;
  const policy = farenhytPolicyModel(rule);
  const net = listAmount != null ? applyFarenhytNet(listAmount) : null;
  const shown = net != null ? currencyDisplay(net, listCurrency) : null;
  return <div className="farenhyt-policy">
    <small>{policy.governed ? "GOVERNED PRICING POLICY" : "UNREVIEWED DISCOUNT — NOT GOVERNED"}</small>
    <strong>{policy.listToNet}</strong>
    <p>{policy.note}</p>
    {listAmount != null && (
      <dl>
        <div><dt>List</dt><dd>{listAmount} {listCurrency || ""}</dd></div>
        <div><dt>Net (× 0.35)</dt><dd>{shown ? shown.text : "UNKNOWN"}</dd></div>
      </dl>
    )}
    {!policy.governed && <small>Do not quote Farenhyt net prices from the 65% figure until a discount_rules row is approved through commercial governance.</small>}
  </div>;
}
