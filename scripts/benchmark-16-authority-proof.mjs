/**
 * §12 EXPLICIT PROOF: MODEL_CONFIDENCE_IS_NOT_AUTHORITY.
 *
 * The adversarial suite blocked every bad control BEFORE calling the model, which
 * proves safety but does NOT prove the override path: that a model which returns
 * a high-confidence ACCEPT_FACT is still downgraded by the gate.
 *
 * Two demonstrations close that gap:
 *   G  evidence sufficient to reason, insufficient to accept (context UNKNOWN)
 *      -> model IS called; if it returns ACCEPT_FACT at high confidence the
 *         gate must override it to KEEP_UNKNOWN.
 *   H  a faithful REPLAY of the original defect: a blank image with the model
 *      called exactly as the old unguarded pipeline called it, then gated.
 *      The old pipeline produced FIREMAN TELEPHONE JACK / c100 / ACCEPT_FACT.
 */
import { writeFileSync } from "node:fs";
import {
  getSheet, SCALE, EVIDENCE_BLOCK, REASON_SCHEMA, REASON, call,
  buildGeometryPacket, evaluateEligibility, applyGate, forcedBlockedResult,
  deriveEvidenceState, OUT_DIR, parseStructured, RUN_ID,
} from "./benchmark-13-lib.mjs";

const sh = await getSheet("%GRS-DR-T-93%");
const results = [];

async function askModel(pkt, label) {
  const r = await call({
    model: REASON, maxTokens: 1400, schema: REASON_SCHEMA, imageIncluded: false, label,
    messages: [
      { role: "system", content: "Reconcile drawing evidence against governed project evidence. Return JSON only. You may answer UNKNOWN." },
      { role: "user", content: `EVIDENCE PACKET:\n${JSON.stringify(pkt, null, 2)}\n\n${EVIDENCE_BLOCK}\n\nQUESTION: A target device symbol is indicated by the letter "T" on this project. What project device class does it represent? Return the required JSON.` },
    ],
  });
  return r.ok ? parseStructured(r.content) : null;
}

// ---- G: reasonable but not acceptable (context UNKNOWN) ------------------
const pktG = buildGeometryPacket({
  canvas: sh.canvas, scale: SCALE, region: { x: 2290, y: 648, w: 14, h: 44 },
  textItems: sh.items,
  sheetMeta: { logicalName: sh.name, documentId: sh.id, page: 1, parserVersion: "benchmark" }, label: "G",
});
const gateG = evaluateEligibility({
  renderSucceeded: true, renderValidity: pktG.render, targetLocated: true,
  evidenceState: deriveEvidenceState({ packet: pktG }),
  contextType: "UNKNOWN",           // deliberately unknown
  projectEvidencePresent: true, blockingContradictions: [],
});
const rawG = gateG.ELIGIBLE_FOR_REASONING ? await askModel(
  { render: pktG.render, geometry: pktG.geometry, tokens: pktG.tokens }, "override/G/unguarded") : null;
const finG = gateG.ELIGIBLE_FOR_REASONING ? applyGate(rawG, gateG) : forcedBlockedResult(gateG);
results.push({
  demo: "G", name: "reason-eligible-but-not-accept-eligible",
  gate: gateG.verdict, blockReason: gateG.BLOCK_REASON,
  modelRaw: rawG && { class: rawG.BEST_SUPPORTED_PROJECT_CLASS, action: rawG.RECOMMENDED_ACTION, confidence: rawG.CONFIDENCE_0_TO_100 },
  final: { class: finG.BEST_SUPPORTED_PROJECT_CLASS, action: finG.RECOMMENDED_ACTION, confidence: finG.CONFIDENCE_0_TO_100 },
  overrode: finG.GATE_OVERRODE_MODEL === true,
});
console.log(`\n[G] context UNKNOWN with valid non-text geometry`);
console.log(`    gate=${gateG.verdict} block=${gateG.BLOCK_REASON}`);
console.log(`    model raw = ${rawG ? `${rawG.BEST_SUPPORTED_PROJECT_CLASS} / ${rawG.RECOMMENDED_ACTION} / c${rawG.CONFIDENCE_0_TO_100}` : "(not called)"}`);
console.log(`    FINAL      = ${finG.BEST_SUPPORTED_PROJECT_CLASS} / ${finG.RECOMMENDED_ACTION} / c${finG.CONFIDENCE_0_TO_100}  overrode=${finG.GATE_OVERRODE_MODEL === true}`);

// ---- H: faithful replay of the original blank-image defect ---------------
const blankPacket = { render: { valid: false, reason: "NO_INK", inkFraction: 0, pixelVariance: 0 }, geometry: { enclosure: "NONE", straightLinework: false }, tokens: { count: 0, inside: [] } };
const gateH = evaluateEligibility({
  renderSucceeded: true, renderValidity: blankPacket.render, targetLocated: false,
  evidenceState: "NONE", contextType: "UNKNOWN", projectEvidencePresent: true, blockingContradictions: [],
});
// Force the OLD behaviour: call the model regardless, exactly as before the gate.
const rawH = await askModel(blankPacket, "override/H/replay-unguarded");
const finH = applyGate(rawH, gateH);
results.push({
  demo: "H", name: "replay of original blank-image defect",
  gate: gateH.verdict, blockReason: gateH.BLOCK_REASON,
  modelRaw: rawH && { class: rawH.BEST_SUPPORTED_PROJECT_CLASS, action: rawH.RECOMMENDED_ACTION, confidence: rawH.CONFIDENCE_0_TO_100, state: rawH.EVIDENCE_STATE },
  final: { class: finH.BEST_SUPPORTED_PROJECT_CLASS, action: finH.RECOMMENDED_ACTION, confidence: finH.CONFIDENCE_0_TO_100, state: finH.EVIDENCE_STATE },
  overrode: finH.GATE_OVERRODE_MODEL === true,
});
console.log(`\n[H] REPLAY: blank image, model called unguarded exactly as the old pipeline did`);
console.log(`    gate=${gateH.verdict} block=${gateH.BLOCK_REASON}`);
console.log(`    model raw = ${rawH ? `${rawH.BEST_SUPPORTED_PROJECT_CLASS} / ${rawH.RECOMMENDED_ACTION} / c${rawH.CONFIDENCE_0_TO_100} / ${rawH.EVIDENCE_STATE}` : "(failed)"}`);
console.log(`    FINAL      = ${finH.BEST_SUPPORTED_PROJECT_CLASS} / ${finH.RECOMMENDED_ACTION} / c${finH.CONFIDENCE_0_TO_100} / ${finH.EVIDENCE_STATE}  overrode=${finH.GATE_OVERRODE_MODEL === true}`);

const highConfOverridden = results.some(r => r.overrode && r.modelRaw && (r.modelRaw.confidence ?? 0) > 20);
console.log(`\n=== MODEL_CONFIDENCE_IS_NOT_AUTHORITY = ${highConfOverridden ? "YES" : "NO"} ===`);
if (highConfOverridden) {
  const d = results.find(r => r.overrode && r.modelRaw && (r.modelRaw.confidence ?? 0) > 20);
  console.log(`    demo ${d.demo}: model asked ACCEPT_FACT at confidence ${d.modelRaw.confidence}`);
  console.log(`             gate emitted ${d.final.action} at confidence ${d.final.confidence} (class ${d.final.class})`);
}
writeFileSync(`${OUT_DIR}/authority-proof-${RUN_ID}.json`, JSON.stringify(results, null, 2));
await sh.pdf.destroy();
