// R11 Mission 3/4 -- READ-ONLY dry run of the governed specification-requirement
// auto-confirmation policy. Evaluates only; performs NO mutation.
import { DatabaseSync } from "node:sqlite";
import { findEligibleSpecRequirements, evaluateSpecRequirementAutoConfirmation } from "../../worker/spec-requirement-auto-confirm.mjs";

const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const DB = process.argv[2];

const sqlite = new DatabaseSync(DB, { readOnly: true });
const wrapper = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return {
      bind(...params) {
        return {
          all: async () => ({ results: stmt.all(...params) }),
          first: async () => stmt.get(...params) ?? null,
          run: async () => { throw new Error("READ-ONLY: run() blocked"); },
        };
      },
    };
  },
};

const eligibility = await findEligibleSpecRequirements(wrapper, PROJECT);
console.log("policyVersion :", eligibility.policyVersion || "(n/a)");
console.log("activeExtractionVersionId :", eligibility.activeExtractionVersionId);
console.log("totalScanned  :", eligibility.total);
console.log("eligible      :", eligibility.eligible?.length);
console.log("reason        :", eligibility.reason || null);

// skip-reason histogram
const hist = {};
for (const e of eligibility.evaluations || []) {
  const k = e.reason || "ELIGIBLE";
  hist[k] = (hist[k] || 0) + 1;
}
console.log("\n--- skip-reason histogram ---");
for (const [k, v] of Object.entries(hist).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(4)}x  ${k}`);

// are the standards / compatibility requirements eligible?
const STD = /\b(SBC|NFPA|UL ?\d|EN ?54|BS ?\d|IEC ?\d|SASO|Civil Defense|standard|code of practice)\b/i;
const COMPAT = /single manufacturer|same manufacturer|compatible|protocol|addressable|loop|SLC|signaling line|UL ?864|interoperab/i;
const targets = (eligibility.evaluations || []).filter((e) => {
  const t = e.requirement?.originalText || e.requirement?.original_text || "";
  return STD.test(t) || COMPAT.test(t);
});
console.log(`\n--- standard/compatibility-bearing requirements: ${targets.length} ---`);
let stdElig = 0, compElig = 0;
for (const e of targets) {
  const t = (e.requirement?.originalText || e.requirement?.original_text || "").slice(0, 84);
  const isStd = STD.test(e.requirement?.originalText || e.requirement?.original_text || "");
  const isComp = COMPAT.test(e.requirement?.originalText || e.requirement?.original_text || "");
  if (e.eligible && isStd) stdElig++;
  if (e.eligible && isComp) compElig++;
  console.log(`  [${e.eligible ? "ELIGIBLE" : "skip   "}] ${t}\n             -> ${e.reason}`);
}
console.log(`\nSUMMARY: standard-bearing eligible = ${stdElig}, compatibility-bearing eligible = ${compElig}`);