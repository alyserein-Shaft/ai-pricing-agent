// Derive the three historical db/schema.ts states from the canonical (post-0010) file.
// READ-ONLY against the canonical tree: writes only inside scratch/.
//
//   state0008 = canonical, applicability carries requirement_source + drawing_requirement_ref,
//               intelligence still pre-0010 (requirement_id NOT NULL, no discriminator columns)
//   state0009 = canonical, applicability device_identity_ref (3-class vocabulary),
//               intelligence still pre-0010
//   state0010 = canonical, byte-identical
//
// The only edits are the exact column declarations; nothing else is touched.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const canonical = readFileSync(resolve("../../../db/schema.ts"), "utf8");

const APP_FINAL = 'requirementId: text("requirement_id").references(() => technicalRequirements.id), deviceIdentityRef: text("device_identity_ref"), status: text("status").notNull(),';
const APP_0008 = 'requirementId: text("requirement_id").references(() => technicalRequirements.id), drawingRequirementRef: text("drawing_requirement_ref"), status: text("status").notNull(),';

const INT_FINAL = 'requirementSource: text("requirement_source").notNull().default("Specification"), requirementId: text("requirement_id").references(() => technicalRequirements.id), deviceIdentityRef: text("device_identity_ref"), factKey: text("fact_key").notNull(),';
const INT_0010 = 'requirementId: text("requirement_id").notNull().references(() => technicalRequirements.id), factKey: text("fact_key").notNull(),';

const replaceOnce = (text, from, to, label) => {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 occurrence, found ${count}`);
  return text.replace(from, to);
};

// 0008: revert the 0009 rename and the whole 0010 intelligence change.
const state0008 = replaceOnce(replaceOnce(canonical, APP_FINAL, APP_0008, "app->drawing"), INT_FINAL, INT_0010, "int->pre0010");
// 0009: keep the rename, still revert 0010.
const state0009 = replaceOnce(canonical, INT_FINAL, INT_0010, "int->pre0010");
// 0010: the canonical file itself.
const state0010 = canonical;

writeFileSync(resolve("db/state0008.ts"), state0008);
writeFileSync(resolve("db/state0009.ts"), state0009);
writeFileSync(resolve("db/state0010.ts"), state0010);

for (const [tag, text] of [["0008", state0008], ["0009", state0009], ["0010", state0010]]) {
  const app = text.includes(APP_0008) ? "drawing_requirement_ref" : "device_identity_ref";
  const disc = text.includes('requirementSource: text("requirement_source")') ? "discriminator=yes" : "discriminator=no";
  console.log(`state${tag}: applicability=${app} intelligence_${disc} bytes=${text.length}`);
}
console.log("state0010 identical to canonical:", state0010 === canonical);
