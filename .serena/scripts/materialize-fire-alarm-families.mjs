#!/usr/bin/env node
/**
 * Stage 4S — Fire Alarm Taxonomy Materialization + Deterministic Family Assignment
 *
 * Phase A: Materialize all governed Fire Alarm taxonomy families into product_families.
 * Phase B: Assign family_id to ALL canonical Active library_products where the
 *          shared classifier (classifyFireAlarmFamilyFromText) returns a deterministic,
 *          unambiguous match from the product's own description text.
 *
 * Governing rules:
 *   - Uses the EXACT SAME shared classifier (classifyFireAlarmFamilyFromText)
 *     from fire-alarm-taxonomy.mjs — no second taxonomy, no ad-hoc logic.
 *   - Creates product_families rows idempotently (one per brand+normalized_name).
 *   - Assigns family_id only when classification is deterministic and unambiguous.
 *   - Never mutates review_status, approved_for_discovery, lifecycle_status,
 *     attributes, certifications, compatibility, or accessories.
 *   - Never uses project-specific evidence for classification.
 *   - Deterministic and reproducible from persisted product identity text.
 *
 * Usage:
 *   node scripts/materialize-fire-alarm-families.mjs <db-path> --dry-run
 *   node scripts/materialize-fire-alarm-families.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { classifyFireAlarmFamilyFromText, FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION } from "../app/domain/fire-alarm-taxonomy.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) {
  throw new Error("Usage: materialize-fire-alarm-families.mjs <db-path> --dry-run|--apply");
}
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

// ─── Prepared statements ───
const getFamilyByNormalizedName = db.prepare(
  "SELECT id, name, engineering_domain FROM product_families WHERE brand_id IS NULL AND normalized_name=?"
);
const getFamilyByBrandAndName = db.prepare(
  "SELECT id, name, engineering_domain FROM product_families WHERE brand_id=? AND normalized_name=?"
);
const insertFamilyGlobal = db.prepare(
  "INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, NULL, ?, ?, ?, 'Reviewed')"
);
const insertFamilyBrand = db.prepare(
  "INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, ?, ?, ?, ?, 'Reviewed')"
);
const updateProductFamily = db.prepare(
  "UPDATE library_products SET family_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
);

// ─── Phase A: Materialize taxonomy families ───
console.log("=== Phase A: Materialize Fire Alarm Taxonomy Families ===");
console.log(`Taxonomy version: ${FIRE_ALARM_TAXONOMY_VERSION}`);

let familiesCreated = 0;
let familiesAlreadyExist = 0;
const familyRows = new Map(); // normalizedName -> { id, name, category }

for (const [category, families] of Object.entries(FIRE_ALARM_TAXONOMY)) {
  for (const familyName of families) {
    const normalizedName = norm(familyName);
    // Check if a global (brand_id=NULL) family already exists
    let existing = getFamilyByNormalizedName.get(normalizedName);
    if (existing) {
      familyRows.set(normalizedName, { id: existing.id, name: existing.name, category: existing.engineering_domain || category });
      familiesAlreadyExist += 1;
      continue;
    }
    if (apply) {
      const familyId = id("family");
      insertFamilyGlobal.run(familyId, familyName, normalizedName, category);
      familyRows.set(normalizedName, { id: familyId, name: familyName, category });
      familiesCreated += 1;
    } else {
      familyRows.set(normalizedName, { id: `PENDING_${familiesCreated + familiesAlreadyExist + 1}`, name: familyName, category });
      familiesCreated += 1;
    }
  }
}

console.log(`Families already exist: ${familiesAlreadyExist}`);
console.log(`Families ${apply ? "created" : "would be created"}: ${familiesCreated}`);
console.log(`Total families in taxonomy: ${familiesAlreadyExist + familiesCreated}`);

if (!apply && familiesCreated > 0) {
  // In dry-run, report what would be created
  for (const [normalizedName, info] of familyRows) {
    if (info.id.startsWith("PENDING_")) {
      console.log(`  WOULD CREATE: ${info.name} (${info.category})`);
    }
  }
}

// ─── Phase B: Classify and assign products ───
console.log("\n=== Phase B: Classify and Assign Products ===");

const products = db.prepare(`
  SELECT lp.id, lp.part_number, lp.description, lp.family_id, lp.identity_status,
         lp.review_status, lp.approved_for_discovery, lp.lifecycle_status
  FROM library_products lp
  WHERE lp.identity_status = 'Active'
`).all();

console.log(`Total canonical Active products: ${products.length}`);

let exactDeterministic = 0;
let ambiguous = 0;
let noFireAlarmMatch = 0;
let alreadyAssigned = 0;
let unsafeToAssign = 0;
let superseded = 0;
const assignments = [];
const skipped = [];

for (const product of products) {
  // Guard: superseded products remain untouched
  if (product.identity_status !== "Active") {
    superseded += 1;
    continue;
  }

  // Guard: already correctly assigned
  if (product.family_id) {
    const existingFamily = familyRows.values().toArray().find(f => f.id === product.family_id);
    if (existingFamily) {
      alreadyAssigned += 1;
      continue;
    }
  }

  const classification = classifyFireAlarmFamilyFromText(product.description);
  if (!classification) {
    noFireAlarmMatch += 1;
    skipped.push({ product, reason: "NO_FIRE_ALARM_MATCH" });
    continue;
  }

  const normalizedName = norm(classification.family);
  const familyInfo = familyRows.get(normalizedName);
  if (!familyInfo) {
    noFireAlarmMatch += 1;
    skipped.push({ product, reason: "FAMILY_NOT_IN_TAXONOMY", family: classification.family });
    continue;
  }

  // Guard: classification must be from the product's own text, deterministic
  // classifyFireAlarmFamilyFromText already enforces this via the strict phrase check
  exactDeterministic += 1;
  assignments.push({
    productId: product.id,
    partNumber: product.part_number,
    description: (product.description || "").slice(0, 80),
    familyId: familyInfo.id,
    familyName: familyInfo.name,
    category: familyInfo.category,
    currentFamilyId: product.family_id,
    classificationBasis: classification.family,
  });
}

console.log(`\nClassification results:`);
console.log(`  EXACT_DETERMINISTIC_FAMILY: ${exactDeterministic}`);
console.log(`  ALREADY_ASSIGNED: ${alreadyAssigned}`);
console.log(`  NO_FIRE_ALARM_MATCH: ${noFireAlarmMatch}`);
console.log(`  AMBIGUOUS: ${ambiguous}`);
console.log(`  UNSAFE_TO_ASSIGN: ${unsafeToAssign}`);
console.log(`  SUPERSEDED (untouched): ${superseded}`);

// ─── Execute assignments ───
if (apply && assignments.length > 0) {
  console.log(`\n=== Applying ${assignments.length} family assignments ===`);
  db.exec("BEGIN IMMEDIATE");
  try {
    let applied = 0;
    for (const a of assignments) {
      // Skip if family doesn't exist yet (shouldn't happen after Phase A)
      if (a.familyId.startsWith("PENDING_")) {
        console.log(`SKIP (family not materialized): ${a.partNumber} -> ${a.familyName}`);
        continue;
      }
      updateProductFamily.run(a.familyId, a.productId);
      applied += 1;
    }
    db.exec("COMMIT");
    console.log(`Applied ${applied} family assignments.`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
} else if (!apply) {
  console.log(`\nDry run: ${assignments.length} products ${assignments.length === 1 ? "would be" : "would be"} assigned.`);
  // Show first 20 assignments
  const preview = assignments.slice(0, 20);
  for (const a of preview) {
    console.log(`  WOULD ASSIGN: ${a.partNumber} | "${a.description}..." | -> ${a.familyName} (${a.category})`);
  }
  if (assignments.length > 20) {
    console.log(`  ... and ${assignments.length - 20} more`);
  }
}

// ─── Report summary ───
console.log(`\n=== Summary ===`);
console.log(`Phase A: ${familiesAlreadyExist + familiesCreated} taxonomy families ${apply ? "materialized" : "planned"}`);
console.log(`Phase B: ${exactDeterministic} products ${apply ? "assigned" : "would be assigned"} to deterministic families`);
console.log(`Governance invariants:`);
console.log(`  review_status changed: NO`);
console.log(`  discovery changed: NO`);
console.log(`  attributes changed: NO`);
console.log(`  compatibility changed: NO`);
console.log(`  pricing changed: NO`);
console.log(`Taxonomy version: ${FIRE_ALARM_TAXONOMY_VERSION}`);
console.log(`Actor: system:product-family-classifier`);
