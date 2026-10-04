import { classifyFireAlarmFamilyFromText, analyzeRequirementFamilyPhrase, looseFireAlarmEquipmentMatch, buildFireAlarmTaxonomyContext, resolveRequirementFamilyPhrase } from "../../app/domain/fire-alarm-taxonomy.mjs";

const strings = [
  "Loop powered strobes with sounder (weatherproof)",
  "Fireman telephone jack",
  "Fire fighter telephone jack",
  "fireman telephones",
  "fireman telephone jack WP",
  "addressable smoke detector",
];
for (const s of strings) {
  const strict = classifyFireAlarmFamilyFromText(s);
  const ctx = buildFireAlarmTaxonomyContext({ description: s });
  const fams = (ctx.families || []).map((f) => `${f.family}${f.basis && f.basis[0] ? `[${f.basis[0]}]` : ""}`);
  const ana = analyzeRequirementFamilyPhrase(s);
  const loose = looseFireAlarmEquipmentMatch(s);
  console.log(JSON.stringify({
    input: s,
    classify: strict,
    contextTop3: fams.slice(0, 3),
    analyzerFamily: ana.family,
    analyzerMatchClass: ana.matchClass,
    analyzerReason: ana.reason,
    loose,
  }));
}
