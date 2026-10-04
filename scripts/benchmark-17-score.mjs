/**
 * §14/§18 SCORING — evaluator only. Run AFTER all model runs are complete.
 * Benchmark truth is applied HERE and was never placed in any prompt.
 */
import { readFileSync, writeFileSync } from "node:fs";

// ---- BENCHMARK TRUTH (evaluator-only) -----------------------------------
const TRUTH = {
  T:  { expectClass: /FIREMAN TELEPHONE JACK/i,        note: "governed legend row T" },
  SC: { expectClass: null, expectModifier: /CEILING/i,
        note: "C is a CEILING modifier/context, NOT an independent device class",
        passIf: (r) => /CEILING/i.test(r.final.BEST_SUPPORTED_PROJECT_CLASS || "") || /CEILING/i.test((r.final.EVIDENCE_GAPS || []).join(" ")) },
  SH: { expectClass: /SMOKE AND HEAT COMBINED DETECTOR/i, note: "governed legend row S H" },
  HC: { expectClass: /^UNKNOWN$/i, note: "unresolved; must stay UNKNOWN",
        passIf: (r) => /^UNKNOWN$/i.test(r.final.BEST_SUPPORTED_PROJECT_CLASS || "") },
};

function correct(r) {
  const t = TRUTH[r.case];
  if (!t) return false;
  if (t.passIf) return t.passIf(r);
  const cls = r.final.BEST_SUPPORTED_PROJECT_CLASS || "";
  return t.expectClass.test(cls);
}

const runs = JSON.parse(readFileSync("out/benchmark/primary-primary.json", "utf8"));
const auth = JSON.parse(readFileSync("out/benchmark/authority-proof-authority2.json", "utf8"));
const adv = JSON.parse(readFileSync("out/benchmark/adversarial-adversarial2.json", "utf8"));

console.log("=== PER-CASE / PER-ARCHITECTURE (3 runs each) ===");
console.log("case  arch  class-correct  action-distribution                          median-ms  vlm-used");
const summary = {};
for (const r of runs) {
  summary[r.case] ??= {};
  summary[r.case][r.arch] ??= [];
  summary[r.case][r.arch].push(r);
}
const archScore = {};
for (const [cs, arches] of Object.entries(summary)) {
  for (const [a, rs] of Object.entries(arches)) {
    const ok = rs.filter(correct).length;
    const actions = {};
    for (const r of rs) actions[r.final.RECOMMENDED_ACTION] = (actions[r.final.RECOMMENDED_ACTION] || 0) + 1;
    const lat = rs.map(r => r.latencyMs).sort((x, y) => x - y);
    const med = lat[Math.floor(lat.length / 2)];
    const vlm = rs.filter(r => r.usedVlm).length;
    archScore[a] ??= { correct: 0, total: 0, lat: [], vlmCalls: 0 };
    archScore[a].correct += ok; archScore[a].total += rs.length;
    archScore[a].lat.push(...lat); archScore[a].vlmCalls += vlm;
    console.log(`${cs.padEnd(5)} ${a.padEnd(5)} ${ok}/${rs.length}          ${JSON.stringify(actions).padEnd(42)} ${String(med).padEnd(9)} ${vlm}/3`);
  }
}

console.log("\n=== ARCHITECTURE COMPARISON ===");
console.log(`arch  semantic-correct  repeatability            median-lat  total-vlm-calls`);
for (const [a, s] of Object.entries(archScore)) {
  const perCase = {};
  for (const r of runs.filter(x => x.arch === a)) perCase[r.case] ??= [], perCase[r.case].push(correct(r));
  const repeat = Object.entries(perCase).map(([c, v]) => `${c}:${v.every(Boolean) ? "3/3" : v.every(x => !x) ? "0/3" : `${v.filter(Boolean).length}/3`}`).join(" ");
  const lat = s.lat.sort((x, y) => x - y);
  console.log(`${a.padEnd(5)} ${s.correct}/${s.total}              ${repeat.padEnd(26)} ${String(lat[Math.floor(lat.length/2)]).padEnd(11)} ${s.vlmCalls}`);
}

console.log("\n=== FAIL-CLOSED SAFETY ===");
console.log(`  adversarial controls: ${adv.filter(r => r.PASS).length}/${adv.length} passed`);
console.log(`  controls that hard-blocked before reasoning: ${adv.filter(r => r.gate === "BLOCKED").length}/${adv.length}`);
const h = auth.find(r => r.demo === "H");
const g = auth.find(r => r.demo === "G");
console.log(`  [H] blank-image replay, model asked ACCEPT_FACT c${h.modelRaw.confidence} -> gate emitted ${h.final.action} c${h.final.confidence}  (overrode=${h.overrode})`);
console.log(`  [G] unknown-context override -> ${g.final.action}  (overrode=${g.overrode})`);
const f = adv.find(r => r.control === "F");
console.log(`  [F] valid non-text geometry accepted (not rejected for GLYPH_COUNT=0): ${f.eligibleForAcceptance}`);

console.log("\n=== BENCHMARK TRUTH vs RUNTIME (Option A, the deterministic-only arm) ===");
for (const [c, t] of Object.entries(TRUTH)) {
  const rs = runs.filter(r => r.case === c && r.arch === "A");
  const cls = [...new Set(rs.map(r => r.final.BEST_SUPPORTED_PROJECT_CLASS))];
  console.log(`  ${c.padEnd(3)} truth: ${t.note}`);
  console.log(`      runtime(A) produced: ${JSON.stringify(cls)}  -> ${rs.filter(correct).length}/${rs.length} correct`);
}

const out = { archScore, adversarial: adv.map(r => ({ control: r.control, pass: r.PASS, gate: r.gate })), authority: auth };
writeFileSync("out/benchmark/score-primary.json", JSON.stringify(out, null, 2));
console.log("\nwrote out/benchmark/score-primary.json");
