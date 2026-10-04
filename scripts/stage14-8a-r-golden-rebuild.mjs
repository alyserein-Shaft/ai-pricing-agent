// STAGE 14.8A-R -- GOVERNED GOLDEN REBUILD, CORPUS-ANCHORED (v2).
//
// The authoritative corpus is: drawing_architecture_review_cases where
// status='Needs Review' (the 21-pending adjudication corpus). Their
// current_snapshot.source.drawingNumber names the REAL governed sheets, and
// their drawing_intake_version_id selects the CURRENT intake to extract from.
//
// Rules (all govern; nothing invented):
//   * Preserve the 3 existing governed keys byte-for-byte
//     (AMS_NET, KGS_005, AMS_002) -- never shrink they are the sanctioned
//     evidence authoring the review corpus.
//   * Remove every SHEET_* zero-asset stub left over from the failed 14.8A.
//   * Add ONE governed key per unique corpus sheet, extracting verbatim
//     Text AND Legend assets via the sanctioned join (cross-sheet references
//     are carried by the Legend/Notes composite blobs, e.g. the KEY PLAN /
//     GENERAL NOTES asset that contains both "REFER" and "DWG NO." in one
//     text blob):
//         drawing_assets.intake_version_id = <corpus case drawing_intake_version_id>
//         AND asset_type IN ('Text','Legend')
//   * Collapse the known overlap: KGS T-93-ZZZ-005 (2 corpus cases) is the
//     SAME governed drawing as KGS_005 -> never a second entry.
//   * Never hand-author; never pad; never infer identities not present in the
//     corpus snapshots. E-00 / T-00 legend sheets are NOT authoring any
//     Needs-Review architecture case, so they are NOT added here.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = fileURLToPath(new URL("./", import.meta.url));
const goldenURL = new URL("../tests/golden/fa-architecture-real-assets.json", `file://${here}`);
const dbPath = process.argv[2];
if (!dbPath || !dbPath.endsWith(".sqlite")) {
  console.error("usage: node stage14-8a-r-golden-rebuild.mjs <LIVE_D1.sqlite>");
  process.exit(2);
}
const db = new DatabaseSync(dbPath);

// --- 1. governed golden preserved verbatim. The only governed keys in the
//        final golden are the 3 sanctioned sheets + the corpus sheets derived
//        below. Any SHEET_* key still present (zero-asset stub OR over-broad
//        leftover) is evidence-less for the ADJUDICATION corpus and is purged
//        so the corpus is fully deterministic. ---
const golden = JSON.parse(readFileSync(goldenURL, "utf8"));
const beforeKeys = Object.keys(golden);
for (const k of beforeKeys) {
  if (k.startsWith("SHEET_")) delete golden[k];
}
console.log(`PURGED SHEET_* leftovers: ${beforeKeys.length - Object.keys(golden).length} (kept ${Object.keys(golden).join(",")})`);

// --- 2. authoritative corpus: 21 Needs-Review cases -> unique sheets + current intake ---
const corpus = db
  .prepare(
    `SELECT DISTINCT
        json_extract(c.current_snapshot,'$.source.drawingNumber') AS dn,
        json_extract(c.current_snapshot,'$.source.sheetName')     AS sn,
        c.drawing_intake_version_id                                AS ivi
     FROM drawing_architecture_review_cases c
     WHERE c.status='Needs Review'`
  )
  .all()
  .filter((r) => r.dn && String(r.dn).trim());

console.log(`UNIQUE corpus sheets: ${corpus.length}`);
for (const r of corpus) console.log(`  ${r.dn} | ${r.sn} | intake ${r.ivi}`);

// --- 3. identity normalization (whitespace-insensitive) for governed dedupe ---
const norm = (v) => String(v ?? "").replace(/\s+/g, "");
const governedIdentity = new Map(); // norm(drawingNumber) -> golden key
for (const k of ["AMS_NET", "KGS_005", "AMS_002"]) {
  if (golden[k]?.drawingNumber) governedIdentity.set(norm(golden[k].drawingNumber), k);
}

const sheetKeyOf = (dn) => {
  const base = (dn || "").replace(/[^A-Za-z0-9]/g, "_").replace(/_{2,}/g, "_");
  return "SHEET_" + base.toUpperCase();
};

let added = 0, collapsed = 0;
for (const r of corpus) {
  const ownedKey = governedIdentity.get(norm(r.dn));
  if (ownedKey) {
    console.log(`COLLAPSE ${r.dn} -> governed ${ownedKey} (same drawing identity)`);
    collapsed++;
    continue;
  }
  const assets = db
    .prepare(
      `SELECT id, asset_type, text_content, bounding_box
       FROM drawing_assets
       WHERE intake_version_id = ? AND asset_type IN ('Text','Legend')
       ORDER BY id`
    )
    .all(r.ivi);
  if (!assets.length) {
    console.log(`SKIP evidence-less ${r.dn} (no Text assets) -- never a stub`);
    continue;
  }
  const key = sheetKeyOf(r.dn);
  golden[key] = {
    drawingNumber: r.dn,
    sheetName: r.sn,
    assets: assets.map((a) => ({
      id: String(a.id),
      assetType: a.asset_type || "Text",
      text: a.text_content,
      box: a.bounding_box ? JSON.parse(a.bounding_box) : null,
    })),
  };
  added++;
  console.log(`ADD ${key} :: ${r.dn} | assets=${assets.length}`);
}

const afterKeys = Object.keys(golden);
console.log(`golden keys BEFORE: ${beforeKeys.length} AFTER: ${afterKeys.length}`);
for (const k of afterKeys) {
  const s = golden[k];
  console.log(`  ${k} :: ${s?.drawingNumber || "?"} | assets=${s?.assets?.length ?? 0}`);
}

writeFileSync(goldenURL, JSON.stringify(golden, null, 2) + "\n");
console.log(`WROTE: ${goldenURL.pathname} (added=${added}, collapsed=${collapsed})`);
console.log("EVIDENCE-DRIVEN; all Text assets verbatim from the live canonical intakes.");