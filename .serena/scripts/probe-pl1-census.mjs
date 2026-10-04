// PL1 probe: Heat Detector library census (read-only).
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite",
  { readOnly: true },
);

const families = db
  .prepare("SELECT id, name, normalized_name, parent_family_id FROM product_families WHERE name LIKE '%Heat%' OR normalized_name LIKE '%heat%' ORDER BY name")
  .all();
console.log("=== FAMILIES MATCHING 'Heat' ===");
console.log(JSON.stringify(families, null, 1));

const famIds = families.map((f) => f.id);
if (famIds.length) {
  const placeholders = famIds.map(() => "?").join(",");
  const products = db
    .prepare(
      `SELECT p.id, m.name AS manufacturer, p.part_number, p.normalized_part_number, p.description,
              p.lifecycle_status, p.review_status, p.approved_for_discovery, p.attributes, p.standards, p.family_id
       FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id
       WHERE p.family_id IN (${placeholders}) ORDER BY m.name, p.normalized_part_number`,
    )
    .all(...famIds);
  console.log(`\n=== PRODUCTS IN HEAT FAMILIES (${products.length}) ===`);
  for (const p of products) {
    console.log(
      JSON.stringify({
        id: p.id,
        manufacturer: p.manufacturer,
        partNumber: p.part_number,
        normalized: p.normalized_part_number,
        description: p.description,
        familyId: p.family_id,
        lifecycle: p.lifecycle_status,
        review: p.review_status,
        discovery: p.approved_for_discovery,
        attributes: JSON.parse(p.attributes || "[]"),
        standards: JSON.parse(p.standards || "[]"),
      }),
    );
  }
}

// Also broad: any product whose part number or description matches heat-detector identifiers
// (IDP-HEAT, FST-951, FST-851, 400-series, notifier ROR) regardless of family tagging.
console.log("\n=== BROAD IDENTIFIER SEARCH (IDP-HEAT / FST- / ROR / heat detector) ===");
const broad = db
  .prepare(
    `SELECT p.id, m.name AS manufacturer, p.part_number, p.description, p.lifecycle_status, p.review_status, p.approved_for_discovery, p.family_id
     FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id
     WHERE UPPER(p.part_number) LIKE '%IDP-HEAT%' OR UPPER(p.part_number) LIKE '%FST-951%' OR UPPER(p.part_number) LIKE '%FST-851%'
        OR p.description LIKE '%heat detector%' OR p.description LIKE '%heat-detector%' OR p.description LIKE '%ROR%'
     ORDER BY m.name, p.normalized_part_number`,
  )
  .all();
for (const p of broad) console.log(JSON.stringify(p));
console.log("\nCENSUS_DONE");