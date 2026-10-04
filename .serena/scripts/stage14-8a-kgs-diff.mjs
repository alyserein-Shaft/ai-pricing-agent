// KGS_005 golden(291) vs live(290) symmetric difference — evidence-only diff.
// Deterministic: bundle-both-sides, print the exact differing assets.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = process.argv[2];
const dbPath = process.argv[3];
const db = new DatabaseSync(dbPath);
const golden = JSON.parse(readFileSync(`${root}/tests/golden/fa-architecture-real-assets.json`, "utf8"));
const ki = "drawingIntake_be6596c0-7855-40d4-bafa-55d37182d894";

const goldenAssets = golden.KGS_005.assets;
const liveRows = db.prepare("SELECT id, text_content, bounding_box FROM drawing_assets WHERE intake_version_id=? AND asset_type='Text' ORDER BY id").all(ki);
const liveById = new Map(liveRows.map((r) => [r.id, r]));

const goldenIds = new Set(goldenAssets.map((a) => a.id));
const liveIds = new Set(liveRows.map((r) => r.id));
const inGoldenOnly = [...goldenIds].filter((id) => !liveIds.has(id));
const inLiveOnly = [...liveIds].filter((id) => !goldenIds.has(id));

console.log(`golden count=${goldenAssets.length}`);
console.log(`live count=${liveRows.length}`);
console.log(`in golden only (${inGoldenOnly.length}):`);
for (const id of inGoldenOnly) {
  const a = goldenAssets.find((x) => x.id === id);
  console.log(`  ${id}  text=${JSON.stringify((a?.text || "").slice(0, 90))}  box=${JSON.stringify(a?.box)}`);
}
console.log(`in live only (${inLiveOnly.length}):`);
for (const id of inLiveOnly) {
  const r = liveById.get(id);
  console.log(`  ${id}  text=${JSON.stringify((r?.text_content || "").slice(0, 90))}  box=${JSON.stringify(r?.bounding_box ? JSON.parse(r.bounding_box) : null)}`);
}