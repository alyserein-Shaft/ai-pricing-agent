// READ-ONLY probe of the governed Fire Alarm family classifier.
// Imports app/domain/fire-alarm-taxonomy.mjs only. No DB, no network, no writes.
import {
  classifyFireAlarmFamilyFromText,
  buildFireAlarmTaxonomyContext,
  looseFireAlarmEquipmentMatch,
  analyzeRequirementFamilyPhrase,
} from "../app/domain/fire-alarm-taxonomy.mjs";

const CASES = [
  "Smoke detectors (above ceiling)",
  "Smoke detectors (below ceiling)",
  "Smoke detectors on slab",
  "Heat detector",
  "Combined smoke and heat detector",
  "Combined smoke and heat sensor",
  "Duct detector",
  "Fire alarm manual station",
  "Fire alarm manual station (weather proof)",
  "Fireman telephone jack",
  "Interface module control",
  "Interface module monitor",
  "Loop powered strobes",
  "Loop powered strobes with sounder",
  "Loop powered strobes with sounder (weatherproof)",
  "Fire alarm control panel with all accessories",
  "CWZ category fire resistant cable with all accessories",
  "Door contact",
  "Signals to elevators with all required accessories",
  "Smoke detectors on slab",
];

const pad = (v, n) => String(v).padEnd(n);
console.log(pad("INPUT", 52), pad("classifyFireAlarmFamilyFromText", 42), pad("loose", 30), "requirementAnalyzer");
console.log("-".repeat(160));
for (const text of CASES) {
  const strict = classifyFireAlarmFamilyFromText(text);
  const ctx = buildFireAlarmTaxonomyContext({ description: text });
  const loose = looseFireAlarmEquipmentMatch(text);
  const req = analyzeRequirementFamilyPhrase(text);
  console.log(
    pad(JSON.stringify(text), 52),
    pad(strict ? `${strict.family} [${strict.category}]` : "null", 42),
    pad(loose || "null", 30),
    `${req.family || "-"} / ${req.matchClass}${req.reason ? " / " + req.reason : ""}` +
      (ctx.multiFunctionConflict ? "  [multiFunctionConflict=true]" : "") +
      (ctx.families.length > 1 ? `  [families=${ctx.families.map((f) => f.family).join("|")}]` : ""),
  );
}

console.log("\n--- detail: candidate families considered by buildFireAlarmTaxonomyContext ---");
console.log("(re-deriving via the same public entry point; only the accepted set is exposed)");
for (const text of CASES) {
  const ctx = buildFireAlarmTaxonomyContext({ description: text, allowMultipleExplicitEntities: true });
  const raw = ctx.families;
  console.log(
    pad(JSON.stringify(text), 52),
    "accepted(all-entities)=",
    raw.length ? raw.map((f) => `${f.family}<-${f.basis[0]}`).join(" , ") : "(none)",
  );
}
