// R11 Phase 2 -- READ-ONLY dry run: which currently-pending applicable_standard
// facts would still be eligible under the tightened OWN_TEXT subject gate?
import { DatabaseSync } from "node:sqlite";
import { evaluateSourceFactCandidate } from "../../worker/spec-source-fact-promotion.mjs";

const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const w = { prepare(s) { const st = db.prepare(s); return { bind(...p) { return { all: async () => ({ results: st.all(...p) }), first: async () => st.get(...p) ?? null }; } }; } };

const facts = (await w.prepare(`SELECT id, scope_id, value FROM engineering_facts WHERE project_id=? AND predicate='applicable_standard' AND status='Pending Review'`).bind(PROJECT).all()).results;
console.log(`pending applicable_standard facts: ${facts.length}\n`);

let keep = 0, drop = 0;
for (const f of facts) {
  // provenance -> the requirement that produced it
  const prov = (await w.prepare(`SELECT source_id, original_text FROM engineering_fact_provenance WHERE fact_id=? LIMIT 1`).bind(f.id).all()).results[0] || {};
  const ev = await evaluateSourceFactCandidate(w, { requirementId: prov.source_id, activeExtractionVersionId: null });
  const cand = (ev.candidates || []).find((c) => c.sourceRowId && c.predicate === "applicable_standard");
  const stdVal = JSON.stringify(cand?.value ?? JSON.parse(f.value));
  const same = cand && stdVal.includes(String(JSON.parse(f.value)?.value?.number ?? ""));
  const basisGate = cand?.gates?.find((g) => g.name === "standard_subject_in_own_text");
  const pass = Boolean(cand?.eligible);
  pass ? keep++ : drop++;
  console.log(`${pass ? "KEEP" : "DROP"}  family=${String(f.scope_id).padEnd(26)} std=${(JSON.parse(f.value)?.value?.body || "?") + " " + (JSON.parse(f.value)?.value?.number || "")}  basis=${cand?.family?.basis ?? "?"}`);
  if (!pass) console.log(`        reason: ${basisGate?.reason || cand?.reason}`);
}
console.log(`\nSUMMARY: ${keep} would remain eligible, ${drop} would be dropped by the OWN_TEXT subject gate`);
