// PL1 probe 2: satellite tables + FlashScan/CLIP/Notifier presence (read-only).
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite",
  { readOnly: true },
);
const FAMILY = "family_a51e96a0-4ced-4941-92a1-9d9f67dfc2e5";

const heatIds = db
  .prepare("SELECT id FROM library_products WHERE family_id=? ORDER BY normalized_part_number")
  .all(FAMILY)
  .map((r) => r.id);

console.log("=== MANUFACTURERS BESIDES HONEYWELL IN HEAT FAMILY ===");
console.log(
  db
    .prepare(
      `SELECT DISTINCT m.id, m.name FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id WHERE p.family_id=?`,
    )
    .all(FAMILY),
);

console.log("\n=== ANY NOTIFIER MANUFACTURER? ===");
console.log(
  db
    .prepare("SELECT id, name, normalized_name, status FROM product_manufacturers WHERE name LIKE '%Notifier%' OR name LIKE '%System Sensor%' OR name LIKE '%NOTIFIER%'")
    .all(),
);

console.log("\n=== product_compatibility rows for heat-family products ===");
{
  const ph = heatIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT pc.source_product_id, pc.target_product_id, pc.target_family_id, pc.relationship_type, pc.conditions_json, pc.required_protocol, pc.evidence_json, pc.review_status, pc.confidence
       FROM product_compatibility pc WHERE pc.source_product_id IN (${ph}) AND pc.deleted_at IS NULL AND pc.superseded_at IS NULL ORDER BY pc.source_product_id`,
    )
    .all(...heatIds);
  console.log("count:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
}

console.log("\n=== product_compatibility rows mentioning FlashScan/CLIP anywhere ===");
{
  const rows = db
    .prepare(
      `SELECT pc.id, pc.source_product_id, pc.target_family_id, pc.relationship_type, pc.required_protocol, pc.conditions_json, pc.review_status
       FROM product_compatibility pc WHERE pc.superseded_at IS NULL AND pc.deleted_at IS NULL
       AND (upper(pc.required_protocol) LIKE '%FLASHSCAN%' OR upper(pc.conditions_json) LIKE '%FLASHSCAN%' OR upper(pc.conditions_json) LIKE '%CLIP%' OR upper(pc.evidence_json) LIKE '%FLASHSCAN%' OR upper(pc.evidence_json) LIKE '%CLIP%')`,
    )
    .all();
  console.log("count:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
}

console.log("\n=== library_products mentioning FlashScan/CLIP in description/attributes/standards ===");
{
  const rows = db
    .prepare(
      `SELECT p.id, p.part_number, p.description, m.name AS manufacturer FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id
       WHERE upper(p.description) LIKE '%FLASHSCAN%' OR upper(p.description) LIKE '% CLIP%' OR upper(p.attributes) LIKE '%FLASHSCAN%' OR upper(p.attributes) LIKE '%CLIP%' OR upper(p.standards) LIKE '%FLASHSCAN%' OR upper(p.standards) LIKE '%CLIP%'`,
    )
    .all();
  console.log("count:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
}

console.log("\n=== product_certifications for heat-family products ===");
{
  const ph = heatIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT pc.product_id, pc.certification_type, pc.standard_body, pc.standard_number, pc.status, pc.review_status, pc.confidence
       FROM product_certifications pc WHERE pc.product_id IN (${ph}) AND pc.deleted_at IS NULL AND pc.superseded_at IS NULL ORDER BY pc.product_id`,
    )
    .all(...heatIds);
  console.log("count:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
}

console.log("\n=== product_lifecycle_events mentioning FST-951 / IDP-HEAT / obsolete heat parts ===");
{
  const rows = db
    .prepare(
      `SELECT plc.id, plc.obsolete_part_number, plc.lifecycle_status, plc.replacement_candidates, plc.review_status, plc.source_location, plc.product_id
       FROM product_lifecycle_events plc WHERE upper(plc.obsolete_part_number) LIKE '%FST%' OR upper(plc.obsolete_part_number) LIKE '%IDP-HEAT%' OR upper(plc.lifecycle_status) LIKE '%OBSOLETE%' OR upper(plc.lifecycle_status) LIKE '%DISCONTINU%'`,
    )
    .all();
  console.log("count:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
}

console.log("\n=== any library product with FST-951 / FST-851 / FDOT part numbers anywhere ===");
{
  const rows = db
    .prepare(
      `SELECT p.id, p.part_number, p.description, m.name AS manufacturer, p.family_id, p.lifecycle_status, p.review_status, p.approved_for_discovery
       FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id
       WHERE UPPER(p.normalized_part_number) LIKE '%FST-95%' OR UPPER(p.normalized_part_number) LIKE '%FST-85%' OR UPPER(p.normalized_part_number) LIKE '%FDOT%'`,
    )
    .all();
  console.log("count:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
}

console.log("\n=== product_identities / canonical registry mentions of FST or IDP-HEAT-ROR (interpretation data) ===");
for (const table of ["product_identities", "product_reference_registry_v2"]) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    console.log(table, "cols:", cols.join(","));
  } catch {
    console.log(table, "MISSING");
  }
}

console.log("\nPROBE2_DONE");