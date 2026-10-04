/**
 * PRIMARY BENCHMARK: options A / B / C over T, S+C, S H, HC. 3 runs each.
 * Truth withheld. Gate applied to every result.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import {
  getSheet, SCALE, classifyRegionDeterministic, EVIDENCE_BLOCK, REASON_SCHEMA, VLM_SCHEMA,
  VLM, REASON, call, legend, buildGeometryPacket, evaluateEligibility, applyGate,
  forcedBlockedResult, deriveEvidenceState, RUNS, OUT_DIR, parseStructured, record, RUN_ID,
} from "./benchmark-13-lib.mjs";

mkdirSync(OUT_DIR, { recursive: true });

const BOS = "%BOS-DR-T-93%";
const GRS = "%GRS-DR-T-93%";

// Target definitions. Geometry is derived from the page; nothing is asserted.
const CASES = [
  { id: "T", like: GRS, tokenX: 2287, rowY: 603, region: { x: 2282, y: 590, w: 40, h: 28 },
    q: "What project device or class does the target represent?" },
  { id: "SC", like: BOS, tokenX: 854, rowY: 1544, region: { x: 846, y: 1530, w: 46, h: 30 },
    q: `The target cell shows a drawn enclosure containing "S" with a second token immediately to its right.
Is that second token an independent device class, a modifier of the enclosure, a schedule structure element, or unresolved?
Use ONLY the supplied evidence. If the evidence does not settle it, answer UNKNOWN.` },
  { id: "SH", like: BOS, tokenX: 927, rowY: 1544, region: { x: 919, y: 1530, w: 46, h: 30 },
    q: `The target cell shows a drawn enclosure containing "S" with a second token immediately to its right.
Identify the semantic relation the governed project evidence establishes for this structure and the project class it corresponds to.
The REGION_TYPE below is authoritative and must not be overridden or second-guessed.` },
  { id: "HC", like: BOS, tokenX: 816, rowY: 1544, region: { x: 808, y: 1530, w: 46, h: 30 },
    q: `The target cell shows a drawn enclosure containing "S" with the two-letter token "HC" immediately to its right.
What does "HC" mean in this project?
If no project evidence defines it you MUST answer UNKNOWN with EVIDENCE_STATE=INSUFFICIENT and RECOMMENDED_ACTION=KEEP_UNKNOWN. Never expand it from general practice.` },
];

async function stage1Vlm(pkt, canvas, scale, label) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(Math.round(pkt.region.width * scale), Math.round(pkt.region.height * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, Math.round(pkt.region.x * scale), Math.round(pkt.region.y * scale),
    Math.round(pkt.region.width * scale), Math.round(pkt.region.height * scale), 0, 0, c.width, c.height);
  const b64 = c.toBuffer("image/png").toString("base64");
  const r = await call({
    model: VLM, maxTokens: 1200, schema: VLM_SCHEMA, imageIncluded: true, imageBase64: b64, label,
    messages: [{ role: "user", content: [
      { type: "text", text: `OBSERVE ONLY. Do NOT classify, interpret or name a device. Report only visible facts about this cropped region of a fire-alarm drawing.
The crop is viewport x=${Math.round(pkt.region.x)} y=${Math.round(pkt.region.y)} w=${Math.round(pkt.region.width)} h=${Math.round(pkt.region.height)} on sheet ${pkt.sheet.logicalName}, page ${pkt.sheet.page}.
If the image contains no drawing content at all, set IMAGE_VALID=NO, VISIBLE_TOKENS=[], ENCLOSURE_SHAPE=NONE, OBSERVATION_CONFIDENCE=0, VISUAL_EVIDENCE_STATE=NO_EVIDENCE.` },
      { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
    ] }],
  });
  return r.ok ? parseStructured(r.content) : null;
}

function reasonPrompt(pkt, region, vlm) {
  return `DETERMINISTIC SHEET / REGION CONTEXT (authoritative; do not re-derive, do not override):
  logicalName: ${pkt.sheet.logicalName}
  documentId: ${pkt.sheet.documentId}
  page: ${pkt.sheet.page}
  parserVersion: ${pkt.sheet.parserVersion}
  REGION_TYPE: ${region.regionType}
  REGION_TYPE_BASIS: ${region.basis}
  renderTransformSource: ${pkt.renderProvenance.transformSource} @${pkt.renderProvenance.renderScale}x

DETERMINISTIC GEOMETRY PACKET (measured from the rendered page, no model involved):
${JSON.stringify({ render: pkt.render, geometry: pkt.geometry, tokens: pkt.tokens }, null, 2)}
${vlm ? `\nVISION OBSERVATION (supplementary; observation only, not interpretation):\n${JSON.stringify(vlm, null, 2)}` : "\n(No vision stage was used for this run. Reason from the deterministic packet alone.)"}
${EVIDENCE_BLOCK}
QUESTION:
${pkt.question}

Rules:
- REGION_TYPE is authoritative. Do not decide whether this is a legend or a schedule yourself.
- If the evidence does not establish the answer, return UNKNOWN / INSUFFICIENT / KEEP_UNKNOWN.
- Never expand an abbreviation from general industry practice.`;
}

const results = [];
for (const c of CASES) {
  const sh = await getSheet(c.like);
  const iv = sh.id;
  const meta = { logicalName: sh.name, documentId: sh.id, page: 1, parserVersion: "drawing-intake-1.x (viewport-normalised for this benchmark)" };
  const tok = sh.items.filter(i => Math.abs(i.x - c.tokenX) < 2.5 && Math.abs(i.y - c.rowY) < 8)
    .sort((a, b) => Math.abs(a.x - c.tokenX) - Math.abs(b.x - c.tokenX))[0];
  const pkt = buildGeometryPacket({
    canvas: sh.canvas, scale: SCALE, region: c.region, textItems: sh.items, sheetMeta: meta, label: c.id,
  });
  pkt.question = c.q;
  const region = classifyRegionDeterministic(pkt, sh.name);

  console.log(`\n##### CASE ${c.id}  region=${region.regionType} (${region.basis})`);
  console.log(`  geometry: enclosure=${pkt.geometry.enclosure} runRatio=${pkt.geometry.runRatio} tokens=${pkt.tokens.count} row=${pkt.tokens.rowNeighbourhood.map(t => t.text).slice(0, 14).join(" ")}`);

  for (const arch of ["A", "B", "C"]) {
    for (let run = 1; run <= RUNS; run++) {
      let vlm = null, usedVlm = false;
      const detState = deriveEvidenceState({ packet: pkt });
      if (arch === "B") { vlm = await stage1Vlm(pkt, sh.canvas, SCALE, `${c.id}/${arch}/run${run}/stage1-vision`); usedVlm = true; }
      if (arch === "C" && detState === "NONE") { vlm = await stage1Vlm(pkt, sh.canvas, SCALE, `${c.id}/${arch}/run${run}/stage1-vision-fallback`); usedVlm = true; }

      const evidenceState = deriveEvidenceState({ packet: pkt, vlmObservation: vlm });
      const gate = evaluateEligibility({
        renderSucceeded: true, renderValidity: pkt.render, targetLocated: !!tok,
        evidenceState, contextType: region.regionType,
        projectEvidencePresent: legend.length > 0,
        blockingContradictions: [],
        ocrUncertainties: vlm?.OCR_UNCERTAINTIES ?? [],
      });

      let raw = null, gated = null, latency = 0;
      if (gate.ELIGIBLE_FOR_REASONING) {
        const r = await call({
          model: REASON, maxTokens: 1800, schema: REASON_SCHEMA, imageIncluded: false,
          label: `${c.id}/${arch}/run${run}/stage2-reason`,
          messages: [
            { role: "system", content: "You reconcile deterministic drawing evidence against governed project evidence for a fire-alarm project. Return JSON only. You MAY and MUST answer UNKNOWN when evidence does not settle the question. Confidence is not authority." },
            { role: "user", content: reasonPrompt(pkt, region, vlm) },
          ],
        });
        latency = r.latencyMs;
        raw = r.ok ? parseStructured(r.content) : null;
        gated = applyGate(raw ?? { TARGET: c.id, BEST_SUPPORTED_PROJECT_CLASS: "UNKNOWN", EVIDENCE_GAPS: ["model call failed"], CONFIDENCE_0_TO_100: 0, EVIDENCE_STATE: "INSUFFICIENT", RECOMMENDED_ACTION: "KEEP_UNKNOWN" }, gate);
      } else {
        gated = forcedBlockedResult(gate, c.id);
      }

      const rec = {
        case: c.id, arch, run, regionType: region.regionType,
        deterministicEvidenceState: detState, evidenceState, usedVlm,
        enclosure: pkt.geometry.enclosure, tokensInCell: pkt.tokens.count,
        gate: gate.verdict, blockReason: gate.BLOCK_REASON,
        eligibleForReasoning: gate.ELIGIBLE_FOR_REASONING, eligibleForAcceptance: gate.ELIGIBLE_FOR_ACCEPTANCE,
        vlm: vlm ? { ENCLOSURE_SHAPE: vlm.ENCLOSURE_SHAPE, VISIBLE_TOKENS: vlm.VISIBLE_TOKENS, state: vlm.VISUAL_EVIDENCE_STATE, conf: vlm.OBSERVATION_CONFIDENCE, imageValid: vlm.IMAGE_VALID } : null,
        modelRaw: raw ? { class: raw.BEST_SUPPORTED_PROJECT_CLASS, role: raw.STRUCTURAL_ROLE, state: raw.EVIDENCE_STATE, action: raw.RECOMMENDED_ACTION, confidence: raw.CONFIDENCE_0_TO_100 } : null,
        final: gated, latencyMs: latency,
      };
      results.push(rec);
      console.log(`  [${arch} run${run}] gate=${gate.verdict.padEnd(24)} ${gate.BLOCK_REASON ? "block=" + gate.BLOCK_REASON.slice(0, 40) : ""}`);
      console.log(`      raw=${raw ? `${raw.BEST_SUPPORTED_PROJECT_CLASS} / ${raw.EVIDENCE_STATE} / ${raw.RECOMMENDED_ACTION} / c${raw.CONFIDENCE_0_TO_100}` : "(not called)"}`);
      console.log(`      FINAL=${gated.BEST_SUPPORTED_PROJECT_CLASS} / ${gated.EVIDENCE_STATE} / ${gated.RECOMMENDED_ACTION} overrode=${gated.GATE_OVERRODE_MODEL} ${latency}ms`);
    }
  }
}

writeFileSync(`${OUT_DIR}/primary-${RUN_ID}.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${OUT_DIR}/primary-${RUN_ID}.json  (${results.length} runs)`);
for (const s of Object.keys(sheetCache)) await sheetCache[s].pdf.destroy();
