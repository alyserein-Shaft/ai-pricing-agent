#!/usr/bin/env node
/**
 * Sprint 1.30 -- real, pre-existing data defect found while inventorying the
 * Addressable Heat Detector family: "IDP-HEAT-ROR-W." (trailing period) is
 * the ONLY trailing-period sibling in this family whose identity_status is
 * still 'Active' (identity_version 1, no superseded_by_product_id) -- every
 * other trailing-period duplicate in this catalog (including its own
 * siblings IDP-HEAT-HT-IV., IDP-HEAT-HT-W., IDP-HEAT-IV., IDP-HEAT-ROR-IV.,
 * IDP-HEAT-W.) was already correctly marked Superseded pointing at the
 * bare-part-number canonical row. This leaves two simultaneously-Active
 * identities for the same physical SKU (IDP-HEAT-ROR-W), which both pass
 * CANONICAL_DISCOVERY_PRODUCT_PREDICATE and could nondeterministically
 * surface in Product Matching or receive duplicated enrichment.
 *
 * Fix: mark "IDP-HEAT-ROR-W." Superseded, pointing at "IDP-HEAT-ROR-W" as
 * canonical, using the exact same fields its own siblings already use
 * (superseded_by_product_id, identity_status, identity_version=2) -- no new
 * mechanism, just applying the existing pattern to the one row that never
 * got it.
 *
 * Usage:
 *   node scripts/correct-idp-heat-ror-w-duplicate-identity.mjs <db-path> --dry-run
 *   node scripts/correct-idp-heat-ror-w-duplicate-identity.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-idp-heat-ror-w-duplicate-identity.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const canonical = db.prepare("SELECT id, part_number, identity_status FROM library_products WHERE part_number='IDP-HEAT-ROR-W' AND identity_status='Active'").get();
const duplicate = db.prepare("SELECT id, part_number, identity_status, superseded_by_product_id, identity_version FROM library_products WHERE part_number='IDP-HEAT-ROR-W.'").get();
if (!canonical) throw new Error("Canonical IDP-HEAT-ROR-W (Active) not found");
if (!duplicate) throw new Error("Duplicate IDP-HEAT-ROR-W. not found");

if (duplicate.identity_status === "Superseded") {
  console.log(`SKIP (already Superseded): IDP-HEAT-ROR-W. -> ${duplicate.superseded_by_product_id}`);
} else {
  console.log(`${apply ? "SUPERSEDE" : "WOULD SUPERSEDE"}: IDP-HEAT-ROR-W. (${duplicate.id}) -> canonical IDP-HEAT-ROR-W (${canonical.id})`);
  if (apply) {
    db.prepare("UPDATE library_products SET identity_status='Superseded', superseded_by_product_id=?, identity_version=2, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(canonical.id, duplicate.id);
  }
}
console.log(apply ? "Applied." : "Dry run only -- no changes made.");
