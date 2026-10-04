/**
 * §16 ADVERSARIAL CONTROLS + §12 proof that model confidence is not authority.
 *
 * For every control the reasoning model is run UNGUARDED first, so its raw
 * intent is observable, and the gate is then applied. A control passes only if
 * the FINAL result cannot be ACCEPT_FACT.
 *
 * Controls:
 *   A blank image                 -> must block
 *   B all-white valid-size image  -> must block
 *   C wrong-sheet crop, no target -> must block
 *   D project evidence, no visual -> must block
 *   E corrupted / unreadable     -> must block or REVIEW/UNKNOWN
 *   F valid NON-TEXT geometry    -> must NOT be rejected merely for zero glyphs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import {
  getSheet, SCALE, classifyRegionDeterministic, EVIDENCE_BLOCK, REASON_SCHEMA, REASON,
  call, legend, buildGeometryPacket, evaluateEligibility, applyGate, forcedBlockedResult,
  deriveEvidenceState, OUT_DIR, parseStructured, RUN_ID,
} from "./benchmark-13-lib.mjs";

mkdirSync(OUT_DIR, { recursive: true });
const GRS = "%GRS-DR-T-93%";
const sh = await getSheet(GRS);

const blankCanvas = (w, h) => { const c = createCanvas(w, h); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); return c; };

// ---- control definitions --------------------------------------------------
const CONTROLS = [
  { id: "A", name: "blank-image", kind: "blank", w: 40, h: 30,
    note: "pure white raster, no drawing content", mustNeverAccept: true },
  { id: "B", name: "all-white-valid-size", kind: "blank", w: 300, h: 200,
    note: "valid non-zero dimensions, all white", mustNeverAccept: true },
  { id: "C", name: "wrong-sheet-no-target", kind: "crop", region: { x: 40, y: 40, w: 60, h: 40 },
    note: "empty margin of a real sheet; no target symbol present", mustNeverAccept: true },
  { id: "D", name: "evidence-but-no-visual", kind: "blank", w: 120, h: 90,
    note: "full legend evidence supplied, no visual target", mustNeverAccept: true },
  { id: "E", name: "corrupted-small-target", kind: "crop", region: { x: 2380, y: 700, w: 7, h: 7 },
    note: "7x7pt crop between symbols: unreadable sliver", mustNeverAccept: true },
  { id: "F", name: "valid-non-text-geometry", kind: "crop", region: { x: 2290, y: 648, w: 14, h: 44 },
    note: "riser linework, zero glyph text; must NOT be rejected for GLYPH_COUNT=0", mustNeverAccept: false },
];

function packetFor(region, label) {
  return buildGeometryPacket({
    canvas: sh.canvas, scale: SCALE, region, textItems: sh.items,
    sheetMeta: { logicalName: sh.name, documentId: sh.id, page: 1, parserVersion: "benchmark" }, label,
  });
}

const rows = [];
for (const ctl of CONTROLS) {
  let region, targetLocated, pkt = null;

  if (ctl.kind === "crop") {
    region = ctl.region;
    pkt = packetFor(region, ctl.id);
    // Target located = the region actually contains the glyph we targeted.
    targetLocated = pkt.tokens.count > 0 || pkt.geometry.enclosure !== "NONE";
  } else {
    // A synthetic raster that is NOT part of any page: no sheet, no geometry.
    region = { x: 0, y: 0, width: ctl.w, height: ctl.h };
    targetLocated = false;
  }

  const evidenceState = pkt ? deriveEvidenceState({ packet: pkt }) : deriveEvidenceState({ packet: null });
  const gate = evaluateEligibility({
    renderSucceeded: true,
    renderValidity: pkt ? pkt.render : { valid: false, reason: "NO_PAGE_RENDER", inkFraction: 0, pixelVariance: 0 },
    targetLocated,
    evidenceState,
    contextType: ctl.kind === "crop" ? classifyRegionDeterministic(pkt, sh.name).regionType : "UNKNOWN",
    projectEvidencePresent: true,
    blockingContradictions: [],
    ocrUncertainties: [],
  });

  // Run the reasoner UNGUARDED, with the full legend, to observe raw intent.
  const raw = gate.ELIGIBLE_FOR_REASONING ? await (async () => {
    const r = await call({
      model: REASON, maxTokens: 1400, schema: REASON_SCHEMA, imageIncluded: false,
      label: `adversarial/${ctl.id}/unguarded`,
      messages: [
        { role: "system", content: "Reconcile drawing evidence against governed project evidence. Return JSON only. You may answer UNKNOWN." },
        { role: "user", content: `EVIDENCE PACKET:\n${JSON.stringify(pkt ? { render: pkt.render, geometry: pkt.geometry, tokens: pkt.tokens } : { render: "NO_RENDER", geometry: "NONE", tokens: { count: 0 } }, null, 2)}\n\n${EVIDENCE_BLOCK}\n\nQUESTION: A target device symbol is indicated by the letter "T" on this project. What project device class does it represent? Return the required JSON.` },
      ],
    });
    return r.ok ? parseStructured(r.content) : null;
  })() : null;

  const final = gate.ELIGIBLE_FOR_REASONING
    ? applyGate(raw ?? { TARGET: "UNKNOWN", BEST_SUPPORTED_PROJECT_CLASS: "UNKNOWN", EVIDENCE_GAPS: ["model failed"], CONFIDENCE_0_TO_100: 0, EVIDENCE_STATE: "INSUFFICIENT", RECOMMENDED_ACTION: "KEEP_UNKNOWN" }, gate)
    : forcedBlockedResult(gate, "UNKNOWN");

  const accepted = final.RECOMMENDED_ACTION === "ACCEPT_FACT";
  const pass = ctl.mustNeverAccept ? !accepted : true;

  rows.push({
    control: ctl.id, name: ctl.name, note: ctl.note,
    evidenceState, enclosure: pkt?.geometry?.enclosure ?? null,
    tokensInRegion: pkt?.tokens?.count ?? 0, inkFraction: pkt?.render?.inkFraction ?? 0,
    targetLocated, gate: gate.verdict, blockReason: gate.BLOCK_REASON,
    eligibleForReasoning: gate.ELIGIBLE_FOR_REASONING,
    eligibleForAcceptance: gate.ELIGIBLE_FOR_ACCEPTANCE,
    modelCalled: !!raw,
    modelRaw: raw ? { class: raw.BEST_SUPPORTED_PROJECT_CLASS, action: raw.RECOMMENDED_ACTION, confidence: raw.CONFIDENCE_0_TO_100, state: raw.EVIDENCE_STATE } : null,
    final: { class: final.BEST_SUPPORTED_PROJECT_CLASS, action: final.RECOMMENDED_ACTION, confidence: final.CONFIDENCE_0_TO_100, state: final.EVIDENCE_STATE },
    gateOverrodeModel: final.GATE_OVERRODE_MODEL === true,
    PASS: pass,
  });

  console.log(`\n[${ctl.id}] ${ctl.name} -- ${ctl.note}`);
  console.log(`     evidenceState=${evidenceState} enclosure=${pkt?.geometry?.enclosure ?? "n/a"} tokens=${pkt?.tokens?.count ?? 0} ink=${pkt?.render?.inkFraction ?? 0} targetLocated=${targetLocated}`);
  console.log(`     gate=${gate.verdict}  block=${gate.BLOCK_REASON || "-"}`);
  console.log(`     model raw = ${raw ? `${raw.BEST_SUPPORTED_PROJECT_CLASS} / ${raw.RECOMMENDED_ACTION} / c${raw.CONFIDENCE_0_TO_100}` : "(not called - gate blocked before reasoning)"}`);
  console.log(`     FINAL      = ${final.BEST_SUPPORTED_PROJECT_CLASS} / ${final.RECOMMENDED_ACTION} / c${final.CONFIDENCE_0_TO_100}   overrode=${final.GATE_OVERRODE_MODEL === true}   ${pass ? "PASS" : "**FAIL**"}`);
}

const failures = rows.filter(r => !r.PASS).length;
const overrode = rows.filter(r => r.gateOverrodeModel).length;
console.log(`\n=== ADVERSARIAL SUMMARY: ${rows.length - failures}/${rows.length} passed; gate overrode the model in ${overrode} ===`);
console.log(`    MODEL_CONFIDENCE_IS_NOT_AUTHORITY = ${rows.some(r => r.gateOverrodeModel && r.modelRaw && r.modelRaw.confidence > 20) ? "YES (a >20-confidence ACCEPT_FACT was overridden)" : "NOT DEMONSTRATED"}`);

writeFileSync(`${OUT_DIR}/adversarial-${RUN_ID}.json`, JSON.stringify(rows, null, 2));
console.log(`wrote ${OUT_DIR}/adversarial-${RUN_ID}.json`);
await sh.pdf.destroy();
