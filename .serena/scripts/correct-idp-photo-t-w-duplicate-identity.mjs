#!/usr/bin/env node
/**
 * Sprint 1.33 -- real, pre-existing data defect found while inventorying
 * base-relationship coverage for the Addressable Smoke Detector family:
 * "IDP-PHOTO-T-W." (trailing period) is a second, simultaneously-Active
 * identity for the same physical SKU as "IDP-PHOTO-T-W" (identity_version 1,
 * no superseded_by_product_id) -- the exact same trailing-period duplicate
 * pattern already corrected for IDP-HEAT-ROR-W in Sprint 1.30, applied here
 * to the one Smoke Detector row that has it.
 *
 * Fix: mark "IDP-PHOTO-T-W." Superseded, pointing at "IDP-PHOTO-T-W" as
 * canonical, using the same fields already used throughout this catalog
 * (superseded_by_product_id, identity_status, identity_version=2).
 *
 * Usage:
 *   node scripts/correct-idp-photo-t-w-duplicate-identity.mjs <db-path> --dry-run
 *   node scripts/correct-idp-photo-t-w-duplicate-identity.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-idp-photo-t-w-duplicate-identity.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const canonical = db.prepare("SELECT id, part_number, identity_status FROM library_products WHERE part_number='IDP-PHOTO-T-W' AND identity_status='Active'").get();
const duplicate = db.prepare("SELECT id, part_number, identity_status, superseded_by_product_id, identity_version FROM library_products WHERE part_number='IDP-PHOTO-T-W.'").get();
if (!canonical) throw new Error("Canonical IDP-PHOTO-T-W (Active) not found");
if (!duplicate) throw new Error("Duplicate IDP-PHOTO-T-W. not found");

if (duplicate.identity_status === "Superseded") {
  console.log(`SKIP (already Superseded): IDP-PHOTO-T-W. -> ${duplicate.superseded_by_product_id}`);
} else {
  console.log(`${apply ? "SUPERSEDE" : "WOULD SUPERSEDE"}: IDP-PHOTO-T-W. (${duplicate.id}) -> canonical IDP-PHOTO-T-W (${canonical.id})`);
  if (apply) {
    db.prepare("UPDATE library_products SET identity_status='Superseded', superseded_by_product_id=?, identity_version=2, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(canonical.id, duplicate.id);
  }
}
console.log(apply ? "Applied." : "Dry run only -- no changes made.");
