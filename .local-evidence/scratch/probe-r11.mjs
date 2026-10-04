import { classifyFireAlarmFamilyFromText, analyzeRequirementFamilyPhrase } from "../../app/domain/fire-alarm-taxonomy.mjs";
for (const s of ["Loop powered strobes", "Flasher", "Red Wall Strobe", "STROBE WHITE WALL", "Sounder"]) {
  console.log(JSON.stringify({ s, classify: classifyFireAlarmFamilyFromText(s)?.family ?? null, analyze: analyzeRequirementFamilyPhrase(s).family ?? null }));
}
