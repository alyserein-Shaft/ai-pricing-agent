// PL1 probe 4 (fixed): provenance via attribute source JSON + identity review table (read-only).
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite",
  { readOnly: true },
);

const PID = "product_161c27bf-70d9-4e3e-b1c9-ad7783dc3dac"; // IDP-HEAT-ROR-IV

console.log("=== raw product_source_evidence rows for IDP-HEAT-ROR-IV ===");
const rows = db
  .prepare("SELECT * FROM product_source_evidence WHERE product_id=?")
  .all(PID);
for (const r of rows) console.log(JSON.stringify(r));

console.log("\n=== product_identity_reviews / canonical resolution references for the part ===");
for (const t of ["product_identity_reviews", "canonical_product_resolution_audit"]) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    console.log("table:", t, "cols:", cols.join(","));
    const hitCols = cols.filter((c) => /product/i.test(c));
    if (hitCols.length) {
      for (const pc of hitCols) {
        try {
          const n = db.prepare(`SELECT count(*) c FROM ${t} WHERE ${pc}='${PID}'`).get();
          if (n.c) {
            console.log(`  rows for PID in ${t}.${pc}: ${n.c}`);
            const sample = db.prepare(`SELECT * FROM ${t} WHERE ${pc}='${PID}' LIMIT 3`).all();
            sample.forEach((s) => console.log("   ", JSON.stringify(s).slice(0, 700)));
          }
        } catch {}
      }
    }
  } catch {
    console.log("table:", t, "MISSING");
  }
}

console.log("\n=== addressable count for NOTIFIER as manufacturer in every product-ish table (belt & braces) ===");
console.log("library_products-notifier:", db.prepare("SELECT count(*) c FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id WHERE upper(m.name) LIKE '%NOTIFIER%'").get().c);
console.log("brands-notifier:", db.prepare("SELECT count(*) c FROM product_brands WHERE upper(name) LIKE '%NOTIFIER%'").get().c);
console.log("distinct manufacturers in library:", db.prepare("SELECT count(DISTINCT m.name) c, group_concat(DISTINCT m.name) names FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id").get());

console.log("\nPROBE4_DONE");