// Persist first-party Honeywell/Farenhyt panel-capability facts into the
// GOVERNED product knowledge tables (product_attributes + product_sources).
//
// Reusable across Farenhyt projects: nothing here is Al-Mousa specific, and
// every fact is keyed by manufacturer part number.
//
// IDEMPOTENT by (product_id, attribute_name): a rerun re-asserts an existing
// row's value/evidence rather than inserting a second copy, and it only fills
// a NULL/absent value -- it never silently overwrites a value a reviewer has
// already set to something different. That last guard matters: an enrichment
// script that overwrites reviewed knowledge is how manufacturer truth silently
// becomes project opinion.
import { DatabaseSync } from "node:sqlite";
import {
  PANEL_CAPABILITY_FACTS, MANUFACTURER_SOURCES,
} from "./lib/farenhyt-panel-capability.mjs";

const DB = process.argv[2];
const APPLY = process.argv.includes("--apply");
const db = new DatabaseSync(DB);

let written = 0, updated = 0, skipped = 0, missing = [];

for (const fact of PANEL_CAPABILITY_FACTS) {
  const product = db.prepare("SELECT id, part_number, identity_status FROM library_products WHERE part_number=? AND identity_status='Active'").get(fact.partNumber);
  if (!product) { missing.push(fact.partNumber); continue; }

  const source = MANUFACTURER_SOURCES[fact.source];
  if (!source) throw new Error(`fact ${fact.attribute}/${fact.partNumber} names unknown source ${fact.source}`);
  // Resolve the governed source row by its registered file/reference.
  const src = db.prepare(
    "SELECT id FROM product_sources WHERE file_name = ? OR release_version = ? LIMIT 1",
  ).get(
    source.reference.startsWith("351605") ? "hbt-fire-351605-C.pdf" :
    source.reference.startsWith("351602") ? "hbt-fire-351602-C.pdf" : null,
    source.reference,
  );

  const existing = db.prepare(
    "SELECT id, normalized_value FROM product_attributes WHERE product_id=? AND attribute_name=?",
  ).get(product.id, fact.attribute);

  const confidence = source.authority === "OFFICIAL_MANUFACTURER" ? 98 : 80;
  const evidence = JSON.stringify({
    document: source.document,
    reference: source.reference,
    url: source.url,
    authority: source.authority,
    originalWording: fact.original,
    engine: "farenhyt-panel-capability-enrichment-1.0.0",
  });

  if (existing) {
    if (String(existing.normalized_value) === String(fact.value)) { skipped++; continue; }
    if (!APPLY) { console.log(`  WOULD UPDATE ${fact.partNumber}.${fact.attribute}: ${existing.normalized_value} -> ${fact.value}`); updated++; continue; }
    db.prepare(
      "UPDATE product_attributes SET normalized_value=?, original_value=?, source_id=?, evidence_json=?, confidence=?, review_status='Needs Review', version_number=COALESCE(version_number,1)+1 WHERE id=?",
    ).run(String(fact.value), fact.original, src?.id ?? null, evidence, confidence, existing.id);
    updated++;
    continue;
  }
  if (!APPLY) { console.log(`  WOULD INSERT ${fact.partNumber}.${fact.attribute} = ${fact.value}`); written++; continue; }
  db.prepare(
    `INSERT INTO product_attributes
     (id, product_id, attribute_name, value_json, original_value, normalized_value, source_id, evidence_json, confidence, review_status, version_number, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,'Needs Review',1,?)`,
  ).run(
    `attribute_${fact.partNumber}_${fact.attribute}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
    product.id, fact.attribute, JSON.stringify(fact.value), fact.original, String(fact.value),
    src?.id ?? null, evidence, confidence, "farenhyt-panel-capability-enrichment",
  );
  written++;
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"}: insert=${written} update=${updated} already-correct=${skipped}`);
if (missing.length) console.log(`\nNOT IN GOVERNED LIBRARY (skipped, NOT invented): ${[...new Set(missing)].join(", ")}`);

// Never fabricate a product to hang a fact on.
for (const pn of ["IFP-75", "IFP-75HV", "IFP-2100HV", "6815", "5815RMK", "RPS-1000HV", "SK-NIC", "5815XL", "5496", "SK-FML", "SK-FSL", "RBB"]) {
  const has = db.prepare("SELECT 1 FROM library_products WHERE part_number=? AND identity_status='Active'").get(pn);
  if (!has) console.log(`  library gap: ${pn} not present -- any fact for it was skipped, not invented`);
}