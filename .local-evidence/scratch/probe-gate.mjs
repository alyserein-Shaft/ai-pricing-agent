import { fireAlarmRequiresPanelCompatibility, fireAlarmCategoryForFamily } from "../../app/domain/fire-alarm-taxonomy.mjs";
import { requiresPanelCompatibility } from "../../app/domain/system-knowledge-registry.mjs";
console.log("family -> categoryForFamily -> requiresPanelCompat(system,cat,fam)");
for (const [cat, fam] of [
  ["Detector","Detector"], ["Module","Module"], ["Control Panel","Control Panel"], ["Sounder","Sounder"],
  ["Detection Devices","Heat Detector"], ["Control Equipment","Fire Alarm Control Panel"], ["Manual Initiation","Manual Call Point"],
  ["Modules and Interfaces","Interface Module"],
]) {
  const cff = fireAlarmCategoryForFamily(fam);
  console.log(`  cat=${String(cat).padEnd(22)} fam=${String(fam).padEnd(26)} catForFam=${String(cff).padEnd(20)} requires=${requiresPanelCompatibility("Fire Alarm", cat, fam)}`);
}
