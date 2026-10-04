import { DatabaseSync } from "node:sqlite";
import { evaluateSourceFactCandidate } from "../../worker/spec-source-fact-promotion.mjs";
const raw = new DatabaseSync(process.argv[2], { readOnly: true });
const w = { prepare(s){const st=raw.prepare(s);return{bind(...p){return{all:async()=>({results:st.all(...p)}),first:async()=>st.get(...p)??null};}};}};
// mimic the test seed: r-b with an inherited-subject family
const ev = await evaluateSourceFactCandidate(w, { requirementId: "r-b", activeExtractionVersionId: "e-b" });
console.log("family:", JSON.stringify(ev.family));
for (const c of ev.candidates) {
  console.log(`  predicate=${c.predicate} eligible=${c.eligible} reason=${c.reason}`);
  for (const g of c.gates) if (!g.pass) console.log(`      FAILED GATE ${g.gate} ${g.name}: ${g.reason}`);
}
