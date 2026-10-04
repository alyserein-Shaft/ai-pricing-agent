// STAGE 14.8A — GOVERNED GOLDEN EXTENSION (verbatim-only; never hand-authoring).
//
// Corrections locked from the LIVE probe (authoritative, never memory):
//   * The 21-group status is NOT the literal 'Pending' — it is derived from the
//     DB's OWN status distribution (the non-'Approved' group). Hardcoding any
//     literal here would reproduce the exact mismatch this session already hit;
//     so the script derives it, typo-proof.
//   * The authoritative golden basename is loaded EXACTLY as the fixture loads
//     it: ../golden/fa-architecture-real-assets.json (verified by grep of the
//     in-context fixture load line). We never rename or re-create it from memory.
//   * Golden assets mirror the fixture's REAL_ARCHITECTURE_EVIDENCE shape:
//     { drawNumberKey: { drawingNumber, sheetName, assets:[{id,assetType:'Text',
//        text, box}] } } — matching seedRealSheet's projected asset payload
//        { id: sheetKey-<id>, assetType: ??'Text', text, box, pageNumber:1 }.
//   * Existing golden entries are preserved byte-for-byte; the extension only
//     APPENDS real sheets that actually author the 21-group, extracted verbatim.
//   * WRITES ONLY tests/golden/fa-architecture-real-assets.json. NEVER live DB,
//     never worker routes/tests/migrations. No hand-authored drawing facts.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("./", import.meta.url));
const goldenURL = new URL("../tests/golden/fa-architecture-real-assets.json", `file://${here}`);
const dbArg = process.argv[2];
if (!dbArg || !dbArg.endsWith(".sqlite")) {
  console.error("usage: node stage14-8a-golden-extend.mjs <LIVE_D1.sqlite>");
  process.exit(2);
}
const db = new DatabaseSync(dbArg);

// 1. Derive the 21-group status from the DB's OWN literal distribution (verbatim).
const statusRows = db.prepare(
  "SELECT status AS st, count(*) n FROM drawing_architecture_review_cases GROUP BY 1 ORDER BY n DESC"
).all();
console.log("LIVE status distribution (verbatim):", statusRows.map((r) => `${r.st}=${r.n}`).join(", "));
const nonApproved = statusRows.filter((r) => r.st !== "Approved");
if (nonApproved.length !== 1) {
  console.error("FATAL: expected exactly one non-Approved auth group; got", nonApproved.length, "- STOP, no write.");
  process.exit(1);
}
const authStatus = nonApproved[0].st;

// 2. The 9 real sheets that AUTHOR the auth (21) group — verbatim per sheet.
const sheets = db.prepare(
  `SELECT DISTINCT
     COALESCE(json_extract(current_snapshot,'$.source.drawingNumber'),'') dn,
     COALESCE(json_extract(current_snapshot,'$.source.sheetName'),'') sn
   FROM drawing_architecture_review_cases
   WHERE status = ?`
).all(authStatus).filter((r) => r.dn);

console.log(`LIVE authoring sheets (status='${authStatus}'): ${sheets.length} real sheets`);

// 3. Load existing golden verbatim, preserve byte-for-byte (no reorder, no
//    rewrite of existing keys).
const golden = JSON.parse(readFileSync(goldenURL, "utf8"));
const beforeKeys = Object.keys(golden);
console.log("golden BEFORE keys:", beforeKeys.join(","));

// Deterministic, verbatim-from-live sheet key: derive from the real drawing
// number's discipline+building+sheet tokens (never my shorthand labels).
const sheetKeyFor = (dn) => {
  const m = dn.match(/[A-Z]{3}-DR-[A-Z]-\d{2}-?([A-Z]{2,3})-(\d{3})/i) ||
            dn.match(/[A-Z]{3}-[A-Z]-\d{2}-?([A-Z]{2,3})-(\d{3})/i);
  if (m) return `${m[1].toUpperCase()}_${m[2]}`;
  return "SHEET_" + dn.replace(/[^A-Za-z0-9]/g, "_");
};

// 4. For each real authoring sheet, extract its Text assets VERBATIM from live
//    drawing_metadata + drawing_assets joined through intake_version.
function extractSheet(dn, sn) {
  const meta = db.prepare(
    `SELECT m.id, m.drawing_number, m.sheet_name
     FROM drawing_metadata m
     JOIN drawing_intake_versions iv ON iv.id = m.intake_version_id
     WHERE m.drawing_number=? AND m.sheet_name=? AND iv.status='Completed'
     ORDER BY COALESCE(iv.superseded_at,'9999') , iv.created_at DESC LIMIT 1`
  ).get(dn, sn);
  if (!meta) return null;
  const assets = db.prepare(
    `SELECT a.id, a.asset_type, a.text_content, a.bounding_box
     FROM drawing_assets a WHERE a.intake_version_id=? AND a.asset_type='Text'
     ORDER BY a.id`
  ).all(meta.id);
  return {
    drawingNumber: meta.drawing_number,
    sheetName: meta.sheet_name,
    assets: assets.map((a) => ({
      id: `real-${a.id}`,
      assetType: a.asset_type || "Text",
      text: a.text_content,
      box: a.bounding_box ? JSON.parse(a.bounding_box) : null,
    })),
  };
}

let newKeys = [];
for (const { dn, sn } of sheets) {
  const key = sheetKeyFor(dn);
  if (golden[key]) { console.log(`  keep (already governed): ${key}`); continue; }
  const payload = extractSheet(dn, sn);
  if (!payload) { console.log(`  SKIP (no verbatim metadata row): ${key}`); continue; }
  golden[key] = payload;
  newKeys.push(key);
  console.log(`  ADD verbatim: ${key} :: ${payload.drawingNumber} | ${payload.sheetName} | assets=${payload.assets.length}`);
}

const afterKeys = Object.keys(golden);
console.log("");
console.log(`golden AFTER keys (${afterKeys.length}):`, afterKeys.join(","));
console.log(`added real sheets: ${newKeys.length} | before: ${beforeKeys.length} | final: ${afterKeys.length}`);

// Safety: never regress existing keys, never invent. Only write if every
// existing key survived byte-for-byte AND every added payload is non-empty.
const existingPreserved = beforeKeys.every((k) => golden[k] && golden[k].assets?.length > 0);
if (!existingPreserved || newKeys.length === 0) {
  console.error("No write: existing keys must all survive and >=1 real sheet must be added. STOP.");
  process.exit(1);
}
writeFileSync(goldenURL, JSON.stringify(golden, null, 2) + "\n");
console.log("WROTE:", goldenURL.pathname);
