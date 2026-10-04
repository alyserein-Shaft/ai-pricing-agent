import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// KN-GOVERNANCE-REPAIR (CLI hardening ratchet).
//
// Historical seed/corpus scripts write canonical Approved engineering
// authority (accessories, compatibilities, attributes) directly, without the
// review/evidence governance the Knowledge promotion path requires. Those
// writes are load-bearing today (matching, sizing, BOM read Approved rows),
// are machine-attributed via created_by markers, and are classified for
// reconciliation as REVIEW_REQUIRED_LEGACY_AUTHORITY -- they are NOT reverted
// here, and this test does not ask for that.
//
// What this test forbids is GROWTH: any new script, or any new Approved
// write site in an existing script, that mints human-equivalent Approved
// engineering truth without review. Future seeding must write Learned /
// Needs Review and route through the review/promotion domain functions, or
// obtain explicit policy approval documented alongside the exception.
//
// The grandfathered set below is frozen. If a legitimate new governed writer
// appears, extend the set deliberately with a dated comment -- never by
// loosening the pattern.
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SCRIPTS_ROOT = join(ROOT, "scripts");

const GRANDFATHERED_APPROVED_WRITERS = new Set([
  "scripts/ingest-notifier-fire-alarm-corpus.mjs",
  "scripts/seed-cctv-compatibility-relationships.mjs",
  "scripts/seed-conventional-detector-attribute-evidence.mjs",
  "scripts/seed-detector-sounder-base-family-attribute-evidence.mjs",
  "scripts/seed-duct-beam-detector-attribute-evidence.mjs",
  "scripts/seed-fire-alarm-accessory-relationships.mjs",
  "scripts/seed-heat-detector-family-attribute-evidence.mjs",
  "scripts/seed-idp-zone-6-attribute-evidence.mjs",
  "scripts/seed-ifp2100-family-attribute-evidence.mjs",
  "scripts/seed-module-interface-family-attribute-evidence.mjs",
  "scripts/seed-multi-criteria-co-detector-attribute-evidence.mjs",
  "scripts/seed-pull-station-annunciator-bell-battery-attribute-evidence.mjs",
  "scripts/seed-sounder-speaker-strobe-family-attribute-evidence.mjs",
  "scripts/seed-strobe-sounder-speaker-standalone-attribute-evidence.mjs",
  // Grandfathered with explicit documented justification in-file: single-row
  // governed promotion (IDP-PHOTO-IV -> B200S-IV Sounding Base) citing official
  // Honeywell datasheet compatibility plus a historical quotation, dry-run
  // gated, idempotent, condition-gated downstream. This is the documented-
  // exception pattern, not a bulk mint.
  "scripts/promote-sounding-base-relationship.mjs",
]);

// The ratchet watches exactly one thing: scripts that WRITE canonical
// engineering truth (product attributes, compatibilities, accessories) while
// carrying a human-equivalent Approved literal. Reads, comparisons, prose,
// requirement auto-confirm paths, and commercial scripts are out of scope:
// they neither mint canonical product truth nor bypass Knowledge governance.
// Positional VALUES binds defeat adjacent-text matching, so the signal is the
// conjunction (writes the table AND stamps Approved), not adjacency.
const CANONICAL_TRUTH_TABLES = [
  "product_attributes",
  "product_compatibility",
  "product_accessories",
];

const writesApprovedAuthority = (source) => {
  const writesTruthTable = CANONICAL_TRUTH_TABLES.some((table) =>
    new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\b|UPDATE\\s+${table}\\b`, "i").test(source)
  );
  if (!writesTruthTable) return false;
  return /(^|[^A-Za-z_])['"]Approved['"]/.test(source);
};

const approvedWriters = () =>
  readdirSync(SCRIPTS_ROOT)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => join("scripts", name))
    .filter((relative) => writesApprovedAuthority(readFileSync(join(ROOT, relative), "utf8")))
    .sort();

test("no new CLI script mints Approved engineering authority without review", () => {
  const actual = approvedWriters();
  assert.deepEqual(
    actual,
    [...GRANDFATHERED_APPROVED_WRITERS].sort(),
    "A script outside the grandfathered set now writes Approved authority. " +
    "Seed as Learned/Needs Review and route through review/promotion, or document explicit policy approval here.",
  );
});

test("grandfathered writers remain machine-attributed (created_by markers)", () => {
  // The reconciliation path distinguishes legacy authority by provenance.
  // Every grandfathered writer that INSERTS new Approved rows must stamp them
  // so REVIEW_REQUIRED_LEGACY_AUTHORITY classification keeps working. (The
  // promote-sounding-base exception only UPDATEs one existing row and
  // deliberately preserves its provenance, which its header documents.)
  const missing = [...GRANDFATHERED_APPROVED_WRITERS].filter((relative) => {
    if (relative.endsWith("promote-sounding-base-relationship.mjs")) return false;
    const source = readFileSync(join(ROOT, relative), "utf8");
    return !/created_by|createdBy/i.test(source);
  });
  assert.deepEqual(missing, [], "grandfathered writers must keep machine attribution for legacy-authority classification");
});
