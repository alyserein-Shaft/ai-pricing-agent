"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../shared/WorkspaceStates";

type Fact = { value: unknown; origin: string; confidence: number } | null;
type EngineerQuestion = { source: string; attributeName: string | null; options: string[]; kind: "CONTROLLED_CHOICE" | "OPEN_INPUT"; question: string } | null;
type CandidateView = {
  candidateId: string; rank: number; manufacturer: string; partNumber: string; family: string | null;
  technicalStatus: string; recommendationTier: string; confidence: string; confidenceScore: number;
  explanation: string; matchingBasis: string[]; mandatoryFailures: unknown[];
  familyMatchTier: number | null; isFallbackCandidate: boolean; rankingReason: string | null; isViable: boolean;
};
type DecisionModel = {
  boqItemId: string; itemReference: string | null; description: string; quantity: unknown; unit: string | null;
  understanding: { status: string; familyClassification: { productFamily: string | null; decisionBasis: string; origin: string; confidence: number | null } | null; governedTaxonomy: { productFamily: string | null; category: string | null; acceptedCandidate: boolean } };
  requirements: { readiness: { status: string } | null; applicableCount: number; consolidated: Array<{ id: string; normalizedRequirement: string; priority: string }>; openClarifications: Array<{ question: string }> };
  candidates: CandidateView[];
  safety: { safetyState: string; complianceState: string; explanation: string } | null;
  recalculation: { status: string };
  currentBlocker: string | null;
  engineerQuestion: EngineerQuestion;
  composite: { state: string; label: string };
};

const COMPOSITE_TONE: Record<string, string> = {
  AI_REVIEW_REQUIRED: "state-pending", STALE_RECALCULATING: "state-pending", RECALCULATION_FAILED: "state-blocked",
  TECHNICAL_DECISION_REQUIRED: "state-pending", NO_MATCH: "state-blocked", TECHNICALLY_READY: "state-ready",
  BOM_NOT_APPLICABLE: "state-pending", BOM_DECISION_REQUIRED: "state-pending", BOM_EVIDENCE_INCOMPLETE: "state-pending", BOM_READY: "state-ready",
  COST_NOT_APPLICABLE: "state-pending", COST_DECISION_REQUIRED: "state-pending", COST_EVIDENCE_INCOMPLETE: "state-pending", COST_READY: "state-ready",
};

type BomQuantity = { value: number | null; unit: string | null; origin: string | null; derivationRule: string | null; source: string; confidence: number | null };
type BomComponent = {
  relationshipType: string; accessoryProductId: string; accessoryPartNumber: string;
  role: "REQUIRED_COMPONENT" | "CONDITIONAL_COMPONENT" | "OPTIONAL_COMPONENT" | "COMPATIBLE_ALTERNATIVE" | "NOT_APPLICABLE";
  quantity: BomQuantity; decisionNeeded: boolean; engineerSelected?: boolean;
};
type BomQuestion = { kind: "ATTRIBUTE_ANSWER" | "ACCESSORY_SELECTION"; attributeName?: string | null; relationshipType?: string; options: Array<string | { accessoryProductId: string; accessoryPartNumber: string }>; question: string } | null;
type BomModel = {
  boqItemId: string;
  primaryProduct: { productId: string; partNumber: string; manufacturer: string; family: string | null; description: string; approved: boolean } | null;
  primaryQuantity: BomQuantity;
  components: BomComponent[];
  engineerQuestion: BomQuestion;
  readiness: { state: string; label: string };
};

const QUANTITY_ORIGIN_LABEL: Record<string, string> = {
  CLIENT_BOQ: "Client BOQ", DRAWING_TAKEOFF: "Drawing Takeoff", ENGINEER_OVERRIDE: "Engineer", DERIVED_FROM_PRIMARY_QUANTITY: "Derived",
};
const quantityBasisLabel = (quantity: BomQuantity) => quantity.value == null ? "Missing BOM decision" : QUANTITY_ORIGIN_LABEL[quantity.origin || ""] || quantity.origin || "Unknown";
const BOM_ROLE_LABEL: Record<string, string> = {
  REQUIRED_COMPONENT: "Required", CONDITIONAL_COMPONENT: "Conditional", OPTIONAL_COMPONENT: "Optional",
  COMPATIBLE_ALTERNATIVE: "Compatible alternative", NOT_APPLICABLE: "Not applicable",
};

type RankedSource = { id: string; priceType: string; amount: number; currency: string; reference: string; validity: string; status: string; eligible: boolean; explanation: string };
type CostQuestion = { kind: "SELECT_PRICE_SOURCE" | "CONFIRM_EXCHANGE_RATE" | "PROVIDE_COST_BASIS"; scope?: string; partNumber?: string; productId?: string; options: Array<{ id: string; priceType: string; amount: number; currency: string; reference: string }>; question: string } | null;
type MaterialBreakdownRow = { scope: string; role: string; partNumber: string | null; relationshipType?: string | null; quantity: BomQuantity; unitCost: number | null; extendedCost: number | null; evidenceSource: string };
type MaterialCostAggregate = { primaryMaterialCost: number | null; requiredComponentCost: number; conditionalComponentCost: number; componentMaterialCost: number; totalMaterialCost: number | null; missingComponents: Array<{ partNumber: string | null; role: string; relationshipType: string | null; status: string }> };
type CostModel = {
  boqItemId: string;
  primaryProduct: { partNumber: string; manufacturer: string; family: string | null } | null;
  primaryQuantity: BomQuantity;
  material: { status: string; approvalReady: boolean; blockers: string[]; selectedSource: { priceType: string; amount: number; currency: string } | null; conversion: { rate: number; convertedAmount: number; direction: string } | null; netMaterialUnitCost: number | null; materialTotal: number | null; directCost: number | null; totalCost: number | null } | null;
  materialBreakdown: MaterialBreakdownRow[];
  materialCost: MaterialCostAggregate;
  priceEvidenceStatus: string;
  selectedCostEvidence: (RankedSource & { selectionBasis: string }) | null;
  rankedSources: RankedSource[];
  nonMaterialComponents: Array<{ id: string; type: string; description: string; method: string; rate: string; amount: number | null; approvalStatus: string }>;
  exchangeRateMissing: boolean;
  summary: { currency: string; materialSubtotal: number | null; serviceSubtotal: number | null; totalCost: number | null };
  costDecisionQuestion: CostQuestion;
  currentBlocker?: string | null;
  readiness: { state: string; label: string };
};
const PRICE_EVIDENCE_LABEL: Record<string, string> = {
  CURRENT_PRICE_AVAILABLE: "Current price available", HISTORICAL_PRICE_ONLY: "Historical evidence only",
  MULTIPLE_PRICE_EVIDENCE: "Multiple price sources", PRICE_CONFLICT: "Conflicting price evidence", PRICE_MISSING: "No costing-eligible evidence",
};

export function EngineerDecisionWorkspace({ boqItemId, onClose }: { boqItemId: string; onClose: () => void }) {
  const [model, setModel] = useState<DecisionModel | null>(null);
  const [bom, setBom] = useState<BomModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answerValue, setAnswerValue] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultNote, setResultNote] = useState("");
  const [bomReason, setBomReason] = useState("");
  const [bomAnswerValue, setBomAnswerValue] = useState("");
  const [bomSubmitting, setBomSubmitting] = useState(false);
  const [bomResultNote, setBomResultNote] = useState("");
  const [cost, setCost] = useState<CostModel | null>(null);
  const [costReason, setCostReason] = useState("");
  const [costSubmitting, setCostSubmitting] = useState(false);
  const [costResultNote, setCostResultNote] = useState("");
  const [fxRate, setFxRate] = useState(""); const [fxValidUntil, setFxValidUntil] = useState("");

  const loadCost = useCallback(async () => {
    try {
      const response = await fetch(`/api/boq-items/${encodeURIComponent(boqItemId)}/cost`, { cache: "no-store" });
      const value = await response.json();
      if (response.ok) setCost(value);
    } catch { /* Cost is a secondary panel -- a load failure here does not block BOM/decision view */ }
  }, [boqItemId]);

  const loadBom = useCallback(async () => {
    try {
      const response = await fetch(`/api/boq-items/${encodeURIComponent(boqItemId)}/bom`, { cache: "no-store" });
      const value = await response.json();
      if (response.ok) setBom(value);
      await loadCost();
    } catch { /* BOM is a secondary panel -- a load failure here does not block the primary decision view */ }
  }, [boqItemId, loadCost]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/boq-items/${encodeURIComponent(boqItemId)}/decision`, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message || "The decision view could not be loaded.");
      setModel(value); setAnswerValue(""); setReason("");
      await loadBom();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The decision view could not be loaded."); }
    finally { setLoading(false); }
  }, [boqItemId, loadBom]);

  useEffect(() => { void load(); }, [load]);

  const submitAnswer = async (value: string) => {
    if (!model?.engineerQuestion?.attributeName || submitting) return;
    if (!reason.trim()) { setError("Provide a substantive engineering reason for this decision."); return; }
    setSubmitting(true); setError(""); setResultNote("");
    try {
      const response = await fetch(`/api/boq-items/${encodeURIComponent(boqItemId)}/decision/answer`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ attributeName: model.engineerQuestion.attributeName, value, reason: reason.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "The decision could not be recorded.");
      setModel(payload.model);
      setResultNote(`Recorded: ${model.engineerQuestion.attributeName} = ${value}. Downstream requirement and matching recalculation ran automatically. Line status is now: ${payload.model.composite.label}.`);
      setAnswerValue(""); setReason("");
      await loadBom();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The decision could not be recorded."); }
    finally { setSubmitting(false); }
  };

  const submitBomAnswer = async (option: string | { accessoryProductId: string; accessoryPartNumber: string }) => {
    if (!bom?.engineerQuestion || bomSubmitting) return;
    if (!bomReason.trim()) { setError("Provide a substantive engineering reason for this BOM decision."); return; }
    setBomSubmitting(true); setError(""); setBomResultNote("");
    try {
      const body = bom.engineerQuestion.kind === "ACCESSORY_SELECTION" && typeof option === "object"
        ? { kind: "ACCESSORY_SELECTION", relationshipType: bom.engineerQuestion.relationshipType, accessoryProductId: option.accessoryProductId, accessoryPartNumber: option.accessoryPartNumber, reason: bomReason.trim() }
        : { kind: "ATTRIBUTE_ANSWER", attributeName: bom.engineerQuestion.attributeName, value: option, reason: bomReason.trim() };
      const response = await fetch(`/api/boq-items/${encodeURIComponent(boqItemId)}/bom/answer`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "The BOM decision could not be recorded.");
      setBom(payload.model);
      setBomResultNote(`BOM decision recorded. Readiness is now: ${payload.model.readiness.label}.`);
      setBomAnswerValue(""); setBomReason("");
      if (payload.cascade) await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The BOM decision could not be recorded."); }
    finally { setBomSubmitting(false); }
  };

  const submitCostAnswer = async (option: { id: string } | null) => {
    if (!cost?.costDecisionQuestion || costSubmitting) return;
    if (!costReason.trim()) { setError("Provide a substantive reason for this cost decision."); return; }
    setCostSubmitting(true); setError(""); setCostResultNote("");
    try {
      const kind = cost.costDecisionQuestion.kind;
      const body = kind === "SELECT_PRICE_SOURCE" && option
        ? { kind, selectedPriceSourceId: option.id, productId: cost.costDecisionQuestion.productId, reason: costReason.trim() }
        : kind === "CONFIRM_EXCHANGE_RATE"
          ? { kind, from: cost.selectedCostEvidence?.currency, to: cost.summary.currency, rate: Number(fxRate), validUntil: fxValidUntil, reason: costReason.trim() }
          : null;
      if (!body) return;
      const response = await fetch(`/api/boq-items/${encodeURIComponent(boqItemId)}/cost/answer`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "The cost decision could not be recorded.");
      setCost(payload.model);
      setCostResultNote(`Cost decision recorded. Readiness is now: ${payload.model.readiness.label}.`);
      setCostReason(""); setFxRate(""); setFxValidUntil("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The cost decision could not be recorded."); }
    finally { setCostSubmitting(false); }
  };

  return <div className="match-overlay" role="dialog" aria-modal="true" aria-labelledby="decision-title">
    <button className="drawer-scrim" onClick={onClose} aria-label="Close engineer decision"/>
    <section className="match-panel decision-panel">
      <header className="match-header">
        <div><small>ENGINEER DECISION CENTER</small><h2 id="decision-title">{model?.description || "BOQ line"}</h2><p>{model?.itemReference || ""} · {model ? `${model.quantity ?? "—"} ${model.unit || ""}` : ""}</p></div>
        <button onClick={onClose}>×</button>
      </header>
      {error && <ErrorState message={error}/>}
      {loading && <LoadingState label="Loading the unified decision view…"/>}
      {!loading && model && <>
        <div className={`composite-line-state ${COMPOSITE_TONE[model.composite.state] || ""}`} role="status">
          <strong>{model.composite.label}</strong><small>{model.composite.state}</small>
        </div>

        <section className="decision-section">
          <h3>AI Understanding</h3>
          <p>Status: <b>{model.understanding.status}</b></p>
          {model.understanding.familyClassification && <p>Family: <b>{model.understanding.familyClassification.productFamily || "Not established"}</b> — {model.understanding.familyClassification.decisionBasis} ({model.understanding.familyClassification.origin}{model.understanding.familyClassification.confidence != null ? ` · ${model.understanding.familyClassification.confidence}%` : ""})</p>}
          <p>Governed taxonomy: {model.understanding.governedTaxonomy.acceptedCandidate ? `${model.understanding.governedTaxonomy.category} / ${model.understanding.governedTaxonomy.productFamily} accepted` : "No governed candidate accepted yet"}</p>
        </section>

        <section className="decision-section">
          <h3>Technical Requirements</h3>
          <p>Readiness: <b>{model.requirements.readiness?.status || "Not yet generated"}</b> · {model.requirements.applicableCount} confirmed applicable</p>
          {model.requirements.consolidated.length > 0 && <ul className="decision-requirement-list">{model.requirements.consolidated.slice(0, 6).map((entry) => <li key={entry.id}><b>{entry.priority}</b> — {entry.normalizedRequirement}</li>)}</ul>}
          {model.requirements.openClarifications.length > 0 && <p className="decision-open-note">{model.requirements.openClarifications.length} open requirement clarification(s)</p>}
        </section>

        <section className="decision-section">
          <h3>Candidate Decision</h3>
          <div className="candidate-list">{model.candidates.map((candidate) => <article key={candidate.candidateId} className="candidate-card">
            <div className="candidate-top"><span>Rank {candidate.rank}{candidate.isFallbackCandidate && <span className="fallback-candidate-badge"> · Fallback</span>}</span><b className={candidate.isViable ? "confidence-high" : "confidence-discovery"}>{candidate.technicalStatus}</b></div>
            <h3>{candidate.manufacturer} · {candidate.partNumber}</h3>
            <p>{candidate.family || "Unclassified family"}</p>
            {candidate.rankingReason && <div className="evidence ranking-reason"><span>Why ranked here</span><p>{candidate.rankingReason}</p></div>}
          </article>)}
          {!model.candidates.length && <EmptyState title="No persisted candidates yet" detail="Run product matching for this item first."/>}</div>
        </section>

        <section className="decision-section decision-action">
          <h3>Engineer Action Required</h3>
          {model.engineerQuestion ? <>
            <p className="decision-question">{model.engineerQuestion.question}</p>
            <small>Source: {model.engineerQuestion.source}</small>
            <label>Reason for this decision<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this value is confirmed (evidence, discussion, drawing reference, ...)"/></label>
            {model.engineerQuestion.kind === "CONTROLLED_CHOICE" ? <div className="decision-choice-buttons">{model.engineerQuestion.options.map((option) => <button key={option} disabled={submitting} onClick={() => void submitAnswer(option)}>{option}</button>)}</div>
              : <div className="decision-open-input"><input value={answerValue} onChange={(event) => setAnswerValue(event.target.value)} placeholder="Concise structured value"/><button disabled={submitting || !answerValue.trim()} onClick={() => void submitAnswer(answerValue.trim())}>Confirm value</button><button disabled={submitting} className="secondary-action" onClick={() => void submitAnswer("Need more evidence")}>Need more evidence</button></div>}
          </> : model.currentBlocker ? <p className="decision-question">{model.currentBlocker}</p> : <p>No open engineer decision — this line is technically ready.</p>}
        </section>

        {resultNote && <section className="decision-section decision-result" role="status"><h3>Result</h3><p>{resultNote}</p></section>}

        {bom && <>
          <div className={`composite-line-state ${COMPOSITE_TONE[bom.readiness.state] || ""}`} role="status">
            <strong>{bom.readiness.label}</strong><small>{bom.readiness.state}</small>
          </div>

          <section className="decision-section">
            <h3>Primary Product</h3>
            {bom.primaryProduct ? <p><b>{bom.primaryProduct.manufacturer} · {bom.primaryProduct.partNumber}</b> — {bom.primaryProduct.family || "Unclassified family"}{!bom.primaryProduct.approved && <span className="fallback-candidate-badge"> · Provisional (not yet technically approved)</span>}<br/>
              <small>Quantity: {bom.primaryQuantity.value ?? "—"} {bom.primaryQuantity.unit || ""} · {quantityBasisLabel(bom.primaryQuantity)}</small></p>
              : <p>No technical selection yet — resolve the Engineer Action above first.</p>}
          </section>

          {(["REQUIRED_COMPONENT", "CONDITIONAL_COMPONENT", "OPTIONAL_COMPONENT", "COMPATIBLE_ALTERNATIVE"] as const).map((role) => {
            const rows = bom.components.filter((c) => c.role === role);
            if (!rows.length) return null;
            return <section className="decision-section" key={role}>
              <h3>{role === "REQUIRED_COMPONENT" ? "Required BOM" : role === "CONDITIONAL_COMPONENT" ? "Conditional Components" : role === "OPTIONAL_COMPONENT" ? "Optional Components" : "Compatible Alternatives"}</h3>
              <ul className="decision-requirement-list">{rows.map((c) => <li key={`${c.relationshipType}:${c.accessoryProductId}`}>
                <b>{c.accessoryPartNumber}</b> — {c.relationshipType}{c.engineerSelected && <span className="fallback-candidate-badge"> · Engineer selected</span>}
                <br/><small>Qty: {c.quantity.value ?? "Missing BOM decision"} {c.quantity.unit || ""} · {quantityBasisLabel(c.quantity)}{c.quantity.derivationRule ? ` (${c.quantity.derivationRule})` : ""}</small>
              </li>)}</ul>
            </section>;
          })}

          <section className="decision-section decision-action">
            <h3>Engineer Action Required — BOM</h3>
            {bom.engineerQuestion ? <>
              <p className="decision-question">{bom.engineerQuestion.question}</p>
              <label>Reason for this decision<textarea value={bomReason} onChange={(event) => setBomReason(event.target.value)} placeholder="Why this component/value is confirmed"/></label>
              {bom.engineerQuestion.kind === "ACCESSORY_SELECTION"
                ? <div className="decision-choice-buttons">{(bom.engineerQuestion.options as Array<{ accessoryProductId: string; accessoryPartNumber: string }>).map((option) => <button key={option.accessoryProductId} disabled={bomSubmitting} onClick={() => void submitBomAnswer(option)}>{option.accessoryPartNumber}</button>)}</div>
                : <div className="decision-open-input"><button disabled={bomSubmitting} onClick={() => void submitBomAnswer("Sounder Required")}>Yes / Required</button><input value={bomAnswerValue} onChange={(event) => setBomAnswerValue(event.target.value)} placeholder="Or a concise structured value"/><button disabled={bomSubmitting || !bomAnswerValue.trim()} onClick={() => void submitBomAnswer(bomAnswerValue.trim())}>Confirm value</button></div>}
            </> : bom.primaryProduct ? <p>No open BOM decision — every component is resolved.</p> : <p>Resolve the technical decision above before the BOM can be built.</p>}
          </section>

          {bomResultNote && <section className="decision-section decision-result" role="status"><h3>BOM Result</h3><p>{bomResultNote}</p></section>}
        </>}

        {cost && <>
          <div className={`composite-line-state ${COMPOSITE_TONE[cost.readiness.state] || ""}`} role="status">
            <strong>{cost.readiness.label}</strong><small>{cost.readiness.state}</small>
          </div>

          <section className="decision-section">
            <h3>Material Cost</h3>
            {cost.primaryProduct ? <>
              <p>Primary price evidence: <b>{PRICE_EVIDENCE_LABEL[cost.priceEvidenceStatus] || cost.priceEvidenceStatus}</b></p>
              <div className="compact-table"><table><thead><tr><th>Scope</th><th>PN</th><th>Quantity</th><th>Unit Cost</th><th>Extended Cost</th><th>Evidence Source</th></tr></thead><tbody>
                {cost.materialBreakdown.map((row) => <tr key={`${row.scope}:${row.partNumber}`}>
                  <td>{row.scope}{row.relationshipType && <small><br/>{row.relationshipType}</small>}</td>
                  <td><b>{row.partNumber || "—"}</b></td>
                  <td>{row.quantity.value ?? "—"} {row.quantity.unit || ""}<br/><small>{quantityBasisLabel(row.quantity)}</small></td>
                  <td>{row.unitCost ?? "—"}</td>
                  <td>{row.extendedCost ?? <span className="fallback-candidate-badge">Missing</span>}</td>
                  <td><small>{row.evidenceSource}</small></td>
                </tr>)}
                {!cost.materialBreakdown.length && <tr><td colSpan={6}>No material lines yet.</td></tr>}
              </tbody></table></div>
              <p><b>Total Material Cost: {cost.materialCost?.totalMaterialCost ?? "Incomplete"} {cost.summary.currency}</b>{cost.materialCost && <small> — Primary {cost.materialCost.primaryMaterialCost ?? "—"} · Required {cost.materialCost.requiredComponentCost} · Conditional {cost.materialCost.conditionalComponentCost}</small>}</p>
              {cost.materialCost?.missingComponents?.length > 0 && <p className="decision-open-note">Missing price evidence for: {cost.materialCost.missingComponents.map((entry) => entry.partNumber || entry.role).join(", ")} — Total Cost withheld until resolved.</p>}
            </> : <p>{cost.currentBlocker || "Resolve the BOM decision above first."}</p>}
          </section>

          {cost.nonMaterialComponents.length > 0 && <section className="decision-section">
            <h3>Services &amp; Other Costs</h3>
            <ul className="decision-requirement-list">{cost.nonMaterialComponents.map((entry) => <li key={entry.id}><b>{entry.type}</b> — {entry.description} ({entry.method}) — {entry.amount ?? "—"} {cost.summary.currency}</li>)}</ul>
          </section>}

          <section className="decision-section decision-action">
            <h3>Cost Summary</h3>
            <p>Total Material Cost: <b>{cost.summary.materialSubtotal ?? "Incomplete"}</b> · Service subtotal: <b>{cost.summary.serviceSubtotal ?? "—"}</b> · <b>Total Cost: {cost.summary.totalCost ?? "—"} {cost.summary.currency}</b></p>
            <small className="decision-open-note">Cost only — no selling price, margin, or discount is calculated in this view.</small>
          </section>

          <section className="decision-section decision-action">
            <h3>Engineer Action Required — Cost</h3>
            {cost.costDecisionQuestion ? <>
              <p className="decision-question">{cost.costDecisionQuestion.question}</p>
              <label>Reason for this decision<textarea value={costReason} onChange={(event) => setCostReason(event.target.value)} placeholder="Why this price/rate is confirmed"/></label>
              {cost.costDecisionQuestion.kind === "SELECT_PRICE_SOURCE"
                ? <div className="decision-choice-buttons">{cost.costDecisionQuestion.options.map((option) => <button key={option.id} disabled={costSubmitting} onClick={() => void submitCostAnswer(option)}>{option.priceType} ({option.amount} {option.currency})</button>)}</div>
                : cost.costDecisionQuestion.kind === "CONFIRM_EXCHANGE_RATE"
                  ? <div className="decision-open-input"><input value={fxRate} onChange={(event) => setFxRate(event.target.value)} placeholder="Rate (e.g. 3.75)"/><input value={fxValidUntil} onChange={(event) => setFxValidUntil(event.target.value)} placeholder="Valid until YYYY-MM-DD"/><button disabled={costSubmitting || !fxRate || !fxValidUntil} onClick={() => void submitCostAnswer(null)}>Confirm rate</button></div>
                  : null}
            </> : cost.primaryProduct ? <p>No open cost decision.</p> : <p>Resolve the BOM decision above before costing.</p>}
          </section>

          {costResultNote && <section className="decision-section decision-result" role="status"><h3>Cost Result</h3><p>{costResultNote}</p></section>}
        </>}
      </>}
      {!loading && !model && !error && <EmptyState title="No decision data" detail="This item has no AI understanding yet."/>}
    </section>
  </div>;
}
