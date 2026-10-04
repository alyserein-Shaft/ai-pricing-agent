import { fireAlarmRequiresPanelCompatibility } from "../../app/domain/fire-alarm-taxonomy.mjs";
import { requiresPanelCompatibility } from "../../app/domain/system-knowledge-registry.mjs";
const cases = [
  // [label, category, family, expected]
  ["1 approved governed Heat Detector", "Detection Devices", "Heat Detector", true],
  ["2 approved governed Manual Call Point", "Manual Initiation", "Manual Call Point", true],
  ["3 approved governed FACP", "Control Equipment", "Fire Alarm Control Panel", true],
  ["4 RAW 'Detector' no approved understanding", "Detector", "Detector", true],
  ["5 RAW 'Module' no approved understanding", "Module", "Module", true],
  ["6 RAW 'Control Panel' no approved understanding", "Control Panel", "Control Panel", true],
  ["7 governed Notification family not panel-locked", "Notification Devices", "Sounder/Strobe", false],
  ["7b governed Sounder", "Notification Devices", "Sounder", false],
];
let ok = 0, bad = 0;
for (const [label, cat, fam, exp] of cases) {
  const got = fireAlarmRequiresPanelCompatibility(cat, fam);
  const pass = got === exp;
  pass ? ok++ : bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}\n        fireAlarmRequiresPanelCompatibility(${JSON.stringify(cat)}, ${JSON.stringify(fam)}) = ${got} (expected ${exp})`);
}
console.log(`\n-- registry pass-through --`);
for (const [sys, cat, fam, exp] of [
  ["Fire Alarm", "Detector", "Detector", true],
  ["Fire Alarm", "Notification Devices", "Sounder/Strobe", false],
  ["CCTV", "Detection Devices", "Addressable Smoke Detector", false],
]) {
  const got = requiresPanelCompatibility(sys, cat, fam);
  const pass = got === exp; pass ? ok++ : bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  requiresPanelCompatibility(${sys}, ${cat}, ${fam}) = ${got} (expected ${exp})`);
}
console.log(`\n-- category-only branch (loopParticipationCategories, family=null) must be UNCHANGED --`);
for (const [cat, exp] of [["Detection Devices", true], ["Control Equipment", true], ["Notification Devices", false], ["Power and Batteries", false]]) {
  const got = fireAlarmRequiresPanelCompatibility(cat, null);
  const pass = got === exp; pass ? ok++ : bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  family=null category=${cat} => ${got} (expected ${exp})`);
}
console.log(`\nRESULT: ${ok} pass, ${bad} fail`);
process.exit(bad ? 1 : 0);
