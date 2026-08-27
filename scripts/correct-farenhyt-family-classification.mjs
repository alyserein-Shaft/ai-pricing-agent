#!/usr/bin/env node
/**
 * Sprint 1.16 -- governed correction of existing Product Knowledge
 * `library_products.family_id` values that predate the per-product
 * reclassification fix in app/domain/product-price-library.mjs
 * (ingestHoneywellFarenhytWorkbook). Before that fix, every product under a
 * section heading that itself didn't resolve to a governed family (e.g. "IDP
 * Addressable Detectors/Devices from System Sensor", which spans smoke, heat,
 * CO and module products at once) was left with either no family at all, or
 * whatever family a prior, less careful pass happened to assign.
 *
 * This script does NOT re-derive classification logic of its own. It is a
 * thin governed-write wrapper around the exact same shared classifier
 * (classifyFireAlarmFamilyFromText, fire-alarm-taxonomy.mjs) the importer and
 * requirement understanding already use -- no second taxonomy, no
 * product-ID/part-number keying. For every Honeywell library_product whose
 * own description text now resolves to a real, governed family that its
 * CURRENT family_id does not already reflect (family_id is null, or points to
 * a family row with no engineering_domain, or points to a DIFFERENT named
 * family than the real classifier returns for this product's own text), it
 * proposes reassigning family_id to the correct governed family -- creating
 * that product_families row first if none exists yet for this brand.
 *
 * Never invents a family the shared classifier didn't itself return. Never
 * touches attributes, standards, pricing, or any other column. Idempotent:
 * a product already pointing at the classifier's own current answer is
 * skipped.
 *
 * An optional --only-families=<comma,separated,family,names> restricts which
 * families this RUN is allowed to write, without touching the detection
 * logic itself -- every candidate the shared classifier finds is still
 * evaluated and reported, only the write is scoped. This run uses it to
 * apply only "Addressable Heat Detector" and "Carbon Monoxide Detector" (this
 * task's actual focus); other genuine candidates the same trace surfaced
 * (e.g. real Speaker/Speaker-Strobe products, and one false-positive risk --
 * see the report) are listed but deliberately left unapplied.
 *
 * Usage:
 *   node scripts/correct-farenhyt-family-classification.mjs <db-path> --dry-run [--only-families=Family One,Family Two]
 *   node scripts/correct-farenhyt-family-classification.mjs <db-path> --apply [--only-families=Family One,Family Two]
 */
import { DatabaseSync } from "node:sqlite";
import { classifyFireAlarmFamilyFromText } from "../app/domain/fire-alarm-taxonomy.mjs";

const [dbPath, mode, ...rest] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-farenhyt-family-classification.mjs <db-path> --dry-run|--apply [--only-families=Family One,Family Two]");
const apply = mode === "--apply";
const onlyFamiliesArg = rest.find((arg) => arg.startsWith("--only-families="));
const onlyFamilies = onlyFamiliesArg ? new Set(onlyFamiliesArg.slice("--only-families=".length).split(",").map((name) => name.trim())) : null;
// Sprint 1.20 -- a human-reviewed, documented exclusion applied at INVOCATION
// time, never inside the classifier. Every candidate is still detected and
// reported by the exact same generic, PN-free classifier; this only lets the
// operator withhold a specific already-inspected proposal that turned out to
// be a genuine accessory-for-the-device (not the device itself) rather than
// the notification device the bare/compound phrase matched on. Each part
// number passed here MUST be accompanied by a reviewer note in the
// invocation itself (see the report this run produces) -- never a silent list.
const excludePartsArg = rest.find((arg) => arg.startsWith("--exclude-parts="));
const excludeParts = excludePartsArg ? new Set(excludePartsArg.slice("--exclude-parts=".length).split(",").map((value) => value.trim())) : new Set();

const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const getFamilyByNormalizedName = db.prepare("SELECT id, name, engineering_domain FROM product_families WHERE brand_id=? AND normalized_name=?");
const insertFamily = db.prepare("INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, ?, ?, ?, ?, 'Needs Review')");
const updateProductFamily = db.prepare("UPDATE library_products SET family_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");

// Sprint 1.27 -- real gap found auditing classification coverage: this query
// used to scan every Honeywell row regardless of identity_status, including
// Superseded duplicate rows (older re-ingested part-number variants, e.g. a
// trailing-period "IDP-PHOTO-IV." superseded by the real "IDP-PHOTO-IV").
// canonical_library_products / CANONICAL_DISCOVERY_PRODUCT_PREDICATE already
// require identity_status='Active' for a product to ever reach Product
// Matching, so classifying a Superseded row can never produce any real
// benefit -- it only adds noise to every future run's proposal list.
const products = db.prepare(`
  SELECT lp.id, lp.part_number, lp.description, lp.family_id, lp.brand_id,
         f.name AS current_family_name, f.engineering_domain AS current_engineering_domain
  FROM library_products lp
  JOIN product_manufacturers m ON m.id = lp.manufacturer_id
  LEFT JOIN product_families f ON f.id = lp.family_id
  WHERE m.normalized_name = 'HONEYWELL' AND lp.identity_status = 'Active'
`).all();

let reassigned = 0, skippedAlreadyCorrect = 0, skippedNoConfidentMatch = 0, skippedOutOfScope = 0, skippedExcluded = 0;
const inScope = [], outOfScope = [], excluded = [];
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const product of products) {
    const classification = classifyFireAlarmFamilyFromText(product.description);
    if (!classification) { skippedNoConfidentMatch += 1; continue; }
    const alreadyCorrect = product.current_engineering_domain && norm(product.current_family_name) === norm(classification.family);
    if (alreadyCorrect) { skippedAlreadyCorrect += 1; continue; }
    const label = `${product.part_number} | "${(product.description || "").slice(0, 60)}..." | ${product.current_family_name || "(none)"} -> ${classification.family}`;
    if (excludeParts.has(product.part_number)) { excluded.push({ product, classification, label }); continue; }
    (onlyFamilies && !onlyFamilies.has(classification.family) ? outOfScope : inScope).push({ product, classification, label });
  }

  for (const { label } of excluded) { console.log(`EXCLUDED (human-reviewed, genuine accessory not the device -- not applied): ${label}`); skippedExcluded += 1; }
  for (const { label } of outOfScope) { console.log(`OUT OF SCOPE (not applied this run): ${label}`); skippedOutOfScope += 1; }

  for (const { product, classification, label } of inScope) {
    console.log(`${apply ? "REASSIGN" : "WOULD REASSIGN"}: ${label}`);
    if (!apply) { reassigned += 1; continue; }
    const normalizedFamilyName = norm(classification.family);
    let family = getFamilyByNormalizedName.get(product.brand_id, normalizedFamilyName);
    if (!family) {
      const familyId = id("family");
      insertFamily.run(familyId, product.brand_id, classification.family, normalizedFamilyName, classification.category);
      family = { id: familyId };
    }
    updateProductFamily.run(family.id, product.id);
    reassigned += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${reassigned} product${reassigned === 1 ? "" : "s"} ${apply ? "reassigned" : "would be reassigned"}, ${skippedAlreadyCorrect} already correct, ${skippedNoConfidentMatch} left unchanged (no confident governed match for their own description text), ${skippedOutOfScope} genuine candidate${skippedOutOfScope === 1 ? "" : "s"} left unapplied (outside --only-families scope for this run), ${skippedExcluded} excluded by human review (genuine accessory, not the device).`);
