// Rescore a candidate from the RAW recorded evidence, with no new model calls.
// Keeps scoring reproducible and auditable, and never re-bills the provider.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { RUN_ID, OUT_DIR, aggregate, CASES, scoreCase } from "./vision-bakeoff-packet.mjs";

const which = process.argv[2];
const raw = readFileSync(`${OUT_DIR}/raw.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = raw.filter((r) => (which ? r.candidate === which : true));
if (!rows.length) { console.error(`no recorded evidence for ${which ?? "any candidate"}`); process.exit(2); }

// Re-derive each case score from the recorded response using the fixed rubric,
// proving the score is a pure function of the recorded evidence.
const byCandidate = {};
for (const r of rows) (byCandidate[r.candidate] ||= []).push(r);

for (const [candidate, rs] of Object.entries(byCandidate)) {
  const cases = rs.map((r) => {
    const def = CASES.find((c) => c.id === r.caseId);
    return scoreCase(def, { text: r.finalResponse, parseOk: r.parseOk, latencyMs: r.latencyMs, errored: !!r.error });
  });
  const agg = aggregate(cases);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/score-${candidate}.json`, JSON.stringify({
    runId: RUN_ID, candidate, provider: rs[0].provider, model: rs[0].model,
    cases, aggregate: agg, rescoredFromRaw: true,
  }, null, 2));
  console.log(`${candidate} (${rs[0].model}) TOTAL = ${agg.total}/100`);
  console.log(`  ${JSON.stringify(Object.fromEntries(Object.entries(agg.dimensionScores).map(([k, v]) => [k, Number(v.toFixed(3))])))}`);
  console.log(`  penaltyTotal=${agg.penaltyTotal} hallucinatedPrintedQuantities=${agg.hallucinatedPrintedQuantities}`);
  console.log(`  latencies(ms)=${rs.map((r) => r.latencyMs).join(",")}`);
}