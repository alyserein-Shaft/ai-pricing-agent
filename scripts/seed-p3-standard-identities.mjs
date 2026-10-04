#!/usr/bin/env node
/**
 * P3 standards semantics pack -- canonical standard-identity seed.
 *
 * Mirrors a curated identity list (body + number only -- identity, never
 * occurrence role) into engineering_taxonomy_terms (Global scope, Active,
 * term_type STANDARD). Parser artifacts without canonical standing
 * ("UL None", truncated "UL 7-", "UL 268A-listed" suffix leak,
 * "BS EN54-*" missegmented parts) are deliberately NOT seeded.
 * Occurrence semantics (PRODUCT_STANDARD vs INSTALLATION_CODE vs ...)
 * live in app/domain/standards-semantics.mjs, never in these rows:
 * the same designation plays different roles in different clauses.
 *
 * No requirement, policy, link, profile, or matching changes.
 *
 * Usage:
 *   node scripts/seed-p3-standard-identities.mjs <db-path> --dry-run
 *   node scripts/seed-p3-standard-identities.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-p3-standard-identities.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const IDENTITIES = [
  ["UL 268", ["UL268"], "Detector clauses (req80, req178, req203); smoke-detector listing context"],
  ["UL 521", ["UL521"], "Heat-detector spacing context; exact-model manufacturer evidence required"],
  ["UL 217", ["UL217"], "Detector clauses (req80, req178, req203)"],
  ["UL 864", ["UL864"], "Control-equipment/panel clauses (req78, req324); panel listing context"],
  ["UL 1971", ["UL1971"], "Strobe clause (req262); notification listing, never a protocol"],
  ["UL 1638", ["UL1638"], "Audible/visual clause (req255)"],
  ["UL 268A", ["UL268A"], "Duct-application listing (req31, req208)"],
  ["NFPA 72", ["NFPA72"], "System code (req79, req314); code, never a compatibility target"],
  ["NFPA 70", ["NFPA70"], "Wiring code Article 760 (req468)"],
  ["EN54", ["EN 54", "EN54"], "System code reference (req79, req468)"],
  ["BS 5839", ["BS5839"], "Wiring/installation code (req361, req468)"],
  ["BS 6387", ["BS6387"], "Fire-resistant cable code (req173, req361)"],
  ["ULC S527", ["ULCS527"], "Control-unit listing (req245)"],
  ["ULC S526", ["ULCS526"], "Signaling-device listing (req262)"],
  ["FM", ["Factory Mutual"], "Approval body (req245); approval, never interoperability"],
  ["ISO 9001", ["ISO9001"], "Manufacturer quality-management certification context only"],
  ["NEC", ["National Electrical Code"], "Wiring code reference"],
];

const db = new DatabaseSync(dbPath);
const existing = new Map(db.prepare("SELECT canonical_name, term_type FROM engineering_taxonomy_terms WHERE scope_type='Global' AND deleted_at IS NULL").all().map((row) => [row.canonical_name, row.term_type]));
const insertTerm = db.prepare("INSERT INTO engineering_taxonomy_terms (id, parent_id, term_type, canonical_name, display_name, code, synonyms, scope_type, scope_id, version_number, status, created_by) VALUES (?, NULL, 'STANDARD', ?, ?, NULL, ?, 'Global', NULL, 1, 'Active', ?)");

const GUARD_TYPES = new Set(["GUARD_STANDARD", "GUARD_VENDOR"]);
let inserted = 0, present = 0;
const drift = [];
for (const [canonical, aliases, provenance] of IDENTITIES) {
  if (existing.has(canonical)) {
    // P2 guard rows (e.g. EN54/FM as GUARD_STANDARD) already govern the
    // term against misuse; retyping them would corrupt P2 semantics, so
    // guard presence satisfies identity without a duplicate row.
    if (existing.get(canonical) !== "STANDARD" && !GUARD_TYPES.has(existing.get(canonical))) drift.push(`${canonical}: table=${existing.get(canonical)}`);
    present += 1;
    continue;
  }
  console.log(`${apply ? "INSERT" : "WOULD INSERT"}: engineering_taxonomy_terms: ${canonical} [STANDARD] -- ${provenance.slice(0, 70)}`);
  if (apply) {
    insertTerm.run(`std-${canonical.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, canonical, canonical, JSON.stringify(aliases), "system:standards-identity-seed");
  }
  inserted += 1;
}
if (drift.length) throw new Error(`Term drift: ${drift.join("; ")}`);
console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} identities ${apply ? "inserted" : "would be inserted"}, ${present} already present.`);
db.close();
