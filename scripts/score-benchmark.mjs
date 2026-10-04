#!/usr/bin/env node
// Stage 4Z — Score benchmark results
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TMP = join(ROOT, "tmp");

// ============================================================
// GROUND TRUTH
// ============================================================
const GROUND_TRUTH = {
  197: { family: "Heat Detector", system: "Fire Alarm", scope: "ITEM_SPECIFIC", roles: ["PRODUCT_ATTRIBUTE", "STANDARD"], isCompound: true,
         keyAttributes: [{ name: "fixedTemperature", value: "135" }, { name: "rateOfRise", value: "15" }],
         keyStandards: ["UL 217"], mustNotDecide: ["190°F"] },
  262: { family: "Strobe", system: "Fire Alarm", scope: "FAMILY_LEVEL", mustNotHaveCompatibilityTarget: ["UL 1971"] },
  115: { mustNotInventManufacturer: true, scope: "SYSTEM_WIDE" },
  10:  { scope: "NON_MATCHING_CONTEXT", roles: ["INSTALLATION"] },
  474: { scope: "NON_MATCHING_CONTEXT", roles: ["TESTING"] },
  500: { scope: "NON_MATCHING_CONTEXT", roles: ["COMMERCIAL"] },
  502: { scope: "NON_MATCHING_CONTEXT", roles: ["COMMERCIAL"] },
  101: { scope: "NON_MATCHING_CONTEXT", roles: ["INFORMATIONAL"] },
  102: { scope: "NON_MATCHING_CONTEXT", roles: ["INFORMATIONAL"] },
  103: { scope: "NON_MATCHING_CONTEXT", roles: ["INFORMATIONAL"] },
};

const dataset = JSON.parse(readFileSync(join(TMP, "benchmark-dataset.json"), "utf-8"));
const dsByNum = Object.fromEntries(dataset.map((d) => [d.number, d]));

function scoreModel(results, label) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== ${label} ===`);
  console.log(`${"=".repeat(60)}`);

  const total = results.length;
  const valid = results.filter((r) => r.validation?.valid).length;
  const errors = results.filter((r) => r.error).length;
  console.log(`Total: ${total} | Valid JSON: ${valid}/${total} (${round(valid/total*100)}%) | Errors: ${errors}`);

  const dims = {};
  const safetyViolations = [];
  let req197Output = null;

  for (const r of results) {
    const n = r.n;
    const out = r.output;
    if (!out) continue;
    if (n === 197) req197Output = out;

    const gt = GROUND_TRUTH[n];
    if (!gt) continue;

    // Family
    if (gt.family !== undefined) {
      const fam = (out.equipmentFamily?.value || "").toLowerCase();
      scoreDim(dims, "family", fam.includes(gt.family.toLowerCase()));
    }

    // System
    if (gt.system !== undefined) {
      const sys = (out.system?.value || "").toLowerCase();
      scoreDim(dims, "system", sys.includes(gt.system.toLowerCase()));
    }

    // Scope
    if (gt.scope !== undefined) {
      scoreDim(dims, "scope", out.scope?.value === gt.scope);
    }

    // Roles
    if (gt.roles !== undefined) {
      const outRoles = new Set(out.role || []);
      const expected = new Set(gt.roles);
      const overlap = [...expected].filter((r) => outRoles.has(r)).length;
      scoreDim(dims, "role", expected.size > 0 && overlap / expected.size >= 0.5);
    }

    // Compound
    if (gt.isCompound !== undefined) {
      scoreDim(dims, "compound", out.compoundRequirement === gt.isCompound);
    }

    // Attribute recall
    if (gt.keyAttributes) {
      const outAttrs = (out.attributes || []).map((a) => `${(a.name||"").toLowerCase()}:${(a.value||"")}`);
      let matched = 0;
      for (const exp of gt.keyAttributes) {
        if (outAttrs.some((a) => a.includes(exp.name.toLowerCase()) && a.includes(exp.value))) matched++;
      }
      scoreDim(dims, "attributeRecall", gt.keyAttributes.length > 0 && matched / gt.keyAttributes.length >= 0.5);
    }

    // Standard recall
    if (gt.keyStandards) {
      const outStds = (out.standards || []).map((s) => s.toLowerCase());
      const matched = gt.keyStandards.filter((s) => outStds.some((o) => o.includes(s.toLowerCase()))).length;
      scoreDim(dims, "standardRecall", gt.keyStandards.length > 0 && matched / gt.keyStandards.length >= 0.5);
    }

    // Safety: no invented manufacturer
    if (gt.mustNotInventManufacturer) {
      const mfrs = out.manufacturers || [];
      scoreDim(dims, "noInventedManufacturer", mfrs.length === 0);
      if (mfrs.length > 0) safetyViolations.push(`#${n}: invented manufacturers ${mfrs.join(", ")}`);
    }

    // Safety: no bad compatibility targets
    if (gt.mustNotHaveCompatibilityTarget) {
      const targets = (out.compatibilityTargets || []).map((t) => (t.target||"").toLowerCase());
      const bad = gt.mustNotHaveCompatibilityTarget.some((b) => targets.some((t) => t.includes(b.toLowerCase())));
      scoreDim(dims, "noBadCompatibility", !bad);
      if (bad) safetyViolations.push(`#${n}: standard used as compatibility target`);
    }

    // Safety: must not decide
    if (gt.mustNotDecide) {
      const text = JSON.stringify(out).toLowerCase();
      const decided = gt.mustNotDecide.some((b) => text.includes(b.toLowerCase()));
      scoreDim(dims, "noUndueDecision", !decided);
      if (decided) safetyViolations.push(`#${n}: decided value it shouldn't have`);
    }
  }

  console.log(`\nDimension Scores (against ${Object.keys(GROUND_TRUTH).length} ground-truth cases):`);
  for (const [dim, [total, correct]] of Object.entries(dims)) {
    if (total === 0) continue;
    const pct = round(correct / total * 100);
    const emoji = pct >= 80 ? "🟢" : pct >= 60 ? "🔵" : pct >= 40 ? "🟡" : "🔴";
    console.log(`  ${emoji} ${dim}: ${correct}/${total} (${pct}%)`);
  }

  console.log(`\nSafety Violations: ${safetyViolations.length}`);
  for (const v of safetyViolations) console.log(`  🔴 ${v}`);

  // Latency
  const latencies = results.filter((r) => r.latencyMs).map((r) => r.latencyMs).sort((a, b) => a - b);
  if (latencies.length) {
    console.log(`\nLatency: median=${latencies[Math.floor(latencies.length/2)]}ms, p95=${latencies[Math.floor(latencies.length*0.95)]}ms, mean=${round(latencies.reduce((a,b)=>a+b,0)/latencies.length)}ms`);
  }

  // Hallucination scan across ALL results
  let hallucinations = 0;
  for (const r of results) {
    const out = r.output;
    if (!out) continue;
    const ds = dsByNum[r.n] || {};
    const srcText = (ds.text || "").toLowerCase();

    // Honeywell -> Notifier/Farenhyt over-inference
    for (const m of (out.manufacturers || [])) {
      if ((m.toLowerCase().includes("notifier") || m.toLowerCase().includes("farenhyt")) && !srcText.includes("notifier") && !srcText.includes("farenhyt")) {
        console.log(`  🔴 #${r.n}: Over-inferred ${m} from Honeywell context`);
        hallucinations++;
      }
    }
    // Standards as compatibility targets
    for (const t of (out.compatibilityTargets || [])) {
      if (["ul 1971","ul 217","ul 268","nfpa 72","en54","bs 5839"].some((s) => (t.target||"").toLowerCase().includes(s))) {
        console.log(`  🔴 #${r.n}: Standard "${t.target}" used as compatibility target`);
        hallucinations++;
      }
    }
  }
  console.log(`\nHallucination/Over-inference issues: ${hallucinations}`);

  // Req 197 comparison
  if (req197Output) {
    console.log(`\n--- Requirement 197 ---`);
    console.log(`  Family: ${req197Output.equipmentFamily?.value || "MISSING"}`);
    console.log(`  System: ${req197Output.system?.value || "MISSING"}`);
    console.log(`  Scope: ${req197Output.scope?.value || "MISSING"}`);
    console.log(`  Roles: ${(req197Output.role || []).join(", ")}`);
    console.log(`  Compound: ${req197Output.compoundRequirement}`);
    console.log(`  Attributes:`);
    for (const a of (req197Output.attributes || [])) {
      console.log(`    ${a.name}: ${a.value} ${a.unit||""} (${a.origin})`);
    }
    console.log(`  Standards: ${(req197Output.standards || []).join(", ")}`);
    console.log(`  Route: ${req197Output.recommendedGovernanceRoute}`);
    console.log(`  Meaning: ${(req197Output.requirementMeaning || "").substring(0, 200)}`);
  }

  return { valid, total, errors, dims, safetyViolations, hallucinations };
}

function scoreDim(dims, name, correct) {
  if (!dims[name]) dims[name] = [0, 0];
  dims[name][0]++;
  if (correct) dims[name][1]++;
}

function round(n) { return Math.round(n); }

// ============================================================
// MAIN
// ============================================================
const modelResults = {};
for (const mk of ["A", "B", "C"]) {
  const path = join(TMP, `benchmark-results-${mk}.json`);
  if (existsSync(path)) {
    modelResults[mk] = JSON.parse(readFileSync(path, "utf-8"));
  }
}

const summaries = {};
for (const [mk, label] of [["A", "Model A: Llama 3.1 8B"], ["B", "Model B: Llama 3.3 70B"], ["C", "Model C: Qwen 3.8 27B"]]) {
  if (modelResults[mk]) {
    summaries[mk] = scoreModel(modelResults[mk], label);
  } else {
    console.log(`\n${label}: NO RESULTS`);
  }
}

// Comparison table
console.log(`\n${"=".repeat(60)}`);
console.log("=== COMPARISON SUMMARY ===");
console.log(`${"=".repeat(60)}`);
console.log(`${"Dimension".padEnd(25)} ${"A (8B)".padStart(10)} ${"B (70B)".padStart(10)} ${"C (Qwen)".padEnd(10)}`);
console.log("-".repeat(55));

const allDims = new Set();
for (const s of Object.values(summaries)) {
  for (const d of Object.keys(s.dims || {})) allDims.add(d);
}

for (const dim of allDims) {
  const row = [dim.padEnd(25)];
  for (const mk of ["A", "B", "C"]) {
    const s = summaries[mk];
    if (!s || !s.dims[dim]) { row.push("-".padStart(10)); continue; }
    const [t, c] = s.dims[dim];
    const pct = t > 0 ? `${round(c/t*100)}%`.padStart(10) : "-".padStart(10);
    row.push(pct);
  }
  console.log(row.join(" "));
}
