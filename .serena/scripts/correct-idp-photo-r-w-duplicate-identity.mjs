#!/usr/bin/env node
/**
 * Sprint 1.36 -- real, pre-existing data defect found while inventorying
 * the Duct Detector family: "IDP-PHOTO-R-W." (trailing period) is a second,
 * simultaneously-Active identity for the same physical SKU as
 * "IDP-PHOTO-R-W" (identity_version 1, no superseded_by_product_id) -- the
 * same trailing-period duplicate pattern already corrected for
 * IDP-HEAT-ROR-W (Sprint 1.30) and IDP-PHOTO-T-W (Sprint 1.33).
 *
 * Fix: mark "IDP-PHOTO-R-W." Superseded, pointing at "IDP-PHOTO-R-W" as
 * canonical, using the same fields already used throughout this catalog
 * (superseded_by_product_id, identity_status, identity_version=2).
 *
 * Usage:
 *   node scripts/correct-idp-photo-r-w-duplicate-identity.mjs <db-path> --dry-run
 *   node scripts/correct-idp-photo-r-w-duplicate-identity.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-idp-photo-r-w-duplicate-identity.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const canonical = db.prepare("SELECT id, part_number, identity_status FROM library_products WHERE part_number='IDP-PHOTO-R-W' AND identity_status='Active'").get();
const duplicate = db.prepare("SELECT id, part_number, identity_status, superseded_by_product_id, identity_version FROM library_products WHERE part_number='IDP-PHOTO-R-W.'").get();
if (!canonical) throw new Error("Canonical IDP-PHOTO-R-W (Active) not found");
if (!duplicate) throw new Error("Duplicate IDP-PHOTO-R-W. not found");

if (duplicate.identity_status === "Superseded") {
  console.log(`SKIP (already Superseded): IDP-PHOTO-R-W. -> ${duplicate.superseded_by_product_id}`);
} else {
  console.log(`${apply ? "SUPERSEDE" : "WOULD SUPERSEDE"}: IDP-PHOTO-R-W. (${duplicate.id}) -> canonical IDP-PHOTO-R-W (${canonical.id})`);
  if (apply) {
    db.prepare("UPDATE library_products SET identity_status='Superseded', superseded_by_product_id=?, identity_version=2, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(canonical.id, duplicate.id);
  }
}
console.log(apply ? "Applied." : "Dry run only -- no changes made.");
