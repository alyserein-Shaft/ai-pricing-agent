/**
 * HARNESS VALIDATION (evaluator-side only).
 * Confirms the deterministic enclosure classifier separates the two shapes the
 * legend distinguishes. Ground truth is used HERE to prove the instrument works
 * and is NEVER placed in any model prompt.
 *
 * Legend ground truth (project ELV legend):
 *   (S) circle        = SMOKE DETECTOR
 *   (S)H circle       = SMOKE AND HEAT COMBINED DETECTOR
 *   [S]C  box         = NOT IN LEGEND (the unresolved structure)
 */
import { loadSheet, renderPage } from "../out/coords/authoritative-coords.mjs";
import { buildGeometryPacket } from "./benchmark-10-geometry.mjs";

const SCALE = 6;
const sh = await loadSheet("%BOS-DR-T-93%");
const canvas = await renderPage(sh.page, sh.vp1, SCALE);
const items = sh.items;

// (token x, expected enclosure from the legend)
const CELLS = [
  { tok: 962, expect: "ROUND", note: "legend (S) SMOKE DETECTOR" },
  { tok: 927, expect: "ROUND", note: "schedule (S)+H combined" },
  { tok: 891, expect: "ROUND", note: "schedule (H) HEAT DETECTOR" },
  { tok: 854, expect: "BOX", note: "schedule [S]+C unresolved" },
  { tok: 816, expect: "BOX", note: "schedule [S]+HC unresolved" },
  { tok: 745, expect: "BOX", note: "schedule dashed [F]" },
  { tok: 781, expect: "BOX", note: "schedule solid [F]" },
];

let pass = 0, fail = 0;
console.log("=== ENCLOSURE CLASSIFIER VALIDATION (evaluator-side) ===");
for (const c of CELLS) {
  // Token baselines in this schedule sit at slightly different heights per row
  // glyph, so match on x and take the nearest baseline in the row band.
  const t = items
    .filter(i => Math.abs(i.x - c.tok) < 2.5 && i.y > 1530 && i.y < 1552)
    .sort((a, b) => Math.abs(a.x - c.tok) - Math.abs(b.x - c.tok))[0];
  if (!t) { console.log(`  x=${c.tok}  TOKEN NOT FOUND`); fail++; continue; }
  const pkt = buildGeometryPacket({
    canvas, scale: SCALE,
    region: { x: t.x - 8, y: t.y - 10, w: 28, h: 22 },
    textItems: items,
    sheetMeta: { logicalName: sh.name, page: 1, parserVersion: "test" },
    label: `cell@${c.tok}`,
  });
  const got = pkt.geometry.enclosure;
  const ok = got === c.expect;
  ok ? pass++ : fail++;
  console.log(`  x=${String(c.tok).padEnd(4)} expect=${c.expect.padEnd(5)} got=${got.padEnd(5)} ${ok ? "PASS" : "**FAIL**"}  ink=${pkt.geometry.inkFraction} corner=${pkt.geometry.cornerDensity} edgeMid=${pkt.geometry.edgeMidDensity} maxHRun=${pkt.geometry.maxHRun} | ${c.note}`);
}
console.log(`\n  classifier: ${pass} pass / ${fail} fail`);
console.log(`  NON-TEXT GEOMETRY DETECTED WITHOUT TEXT: ${pass > 0 ? "YES" : "NO"}`);
await sh.pdf.destroy();
