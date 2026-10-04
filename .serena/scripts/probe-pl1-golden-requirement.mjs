// PL1 probe 3: Golden requirement 197 content (read-only) + identity-registry FST/Notifier check.
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite",
  { readOnly: true },
);

const REQ = "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_197";

// technical_requirements DDL shape
const cols = db.prepare("PRAGMA table_info(technical_requirements)").all().map((c) => c.name);
console.log("technical_requirements cols:", cols.join(","));

const row = db.prepare("SELECT * FROM technical_requirements WHERE id=?").get(REQ);
if (!row) {
  console.log("requirement 197 NOT FOUND in technical_requirements");
} else {
  const out = {};
  for (const c of cols) {
    const v = row[c];
    out[c] = typeof v === "string" && v.length > 900 ? v.slice(0, 900) + "…[truncated]" : v;
  }
  console.log("\n=== REQUIREMENT 197 (raw) ===");
  console.log(JSON.stringify(out, null, 1));
}

// Also check consolidated_profile_requirements for a row referencing this requirement or heat detector
const cpcols = db.prepare("PRAGMA table_info(consolidated_profile_requirements)").all().map((c) => c.name);
console.log("\nconsolidated_profile_requirements cols:", cpcols.join(","));

// identity registry FST/Notifier check
console.log("\n=== product_identities mentioning FST / Notifier / FlashScan / CLIP ===");
const idRows = db
  .prepare(
    `SELECT id, manufacturer, brand, series, model, official_product_code, lifecycle_status, confidence, review_status
     FROM product_identities
     WHERE upper(coalesce(series,'')) LIKE '%FST%' OR upper(coalesce(model,'')) LIKE '%FST%'
        OR upper(coalesce(official_product_code,'')) LIKE '%FST%' OR upper(coalesce(official_product_code,'')) LIKE '%IDP-HEAT%'
        OR upper(coalesce(manufacturer,'')) LIKE '%NOTIFIER%' OR upper(coalesce(brand,'')) LIKE '%NOTIFIER%'
        OR upper(coalesce(description,'')) LIKE '%FLASHSCAN%' OR upper(coalesce(description,'')) LIKE '%CLIP%'
     LIMIT 60`,
  )
  .all();
console.log("count:", idRows.length);
for (const r of idRows) console.log(JSON.stringify(r));

// product_source_evidence for the heat family products — number of sources each
console.log("\n=== product_source_evidence count per heat product ===");
const heatIds = db
  .prepare("SELECT id, part_number FROM library_products WHERE family_id='family_a51e96a0-4ced-4941-92a1-9d9f67dfc2e5'")
  .all();
for (const h of heatIds) {
  const n = db
    .prepare("SELECT count(*) AS c FROM product_source_evidence WHERE product_id=?" )
    .get(h.id);
  console.log(h.part_number, "->", n.c, "source rows");
}

console.log("\nPROBE3_DONE");