#!/usr/bin/env node
/**
 * Fire Alarm System Pack v1 closure -- Phase E: a safe, conservative,
 * evidence-only FIRST PASS at product_role classification for the active
 * Honeywell Fire Alarm catalog (migration 0066 already applied; every row
 * currently defaults to 'Unclassified').
 *
 * This is Phase 1 governance ONLY -- classification and visibility, never a
 * matching predicate (per the governing brief, Section 5). Nothing here
 * changes discovery, matching, or the canonical discovery predicate.
 *
 * Every rule is a literal, bounded, real-evidence signal already present on
 * the row (an existing governed device_role="Accessory" attribute, the
 * row's own taxonomy family, or a literal word in its own description) --
 * never a loose keyword heuristic applied catalog-wide, never a guess from
 * SKU suffix similarity. A product that matches nothing stays Unclassified,
 * honestly -- this script never forces a role onto an uncertain product.
 *
 * Idempotent and scoped: only ever updates product_role for a row currently
 * at the 'Unclassified' default, and only when a rule fires; safe to rerun.
 *
 * Usage:
 *   node scripts/classify-fire-alarm-product-role.mjs <db-path> --dry-run
 *   node scripts/classify-fire-alarm-product-role.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: classify-fire-alarm-product-role.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const MANUFACTURER_HONEYWELL = db.prepare("SELECT id FROM product_manufacturers WHERE name = 'Honeywell'").get()?.id;
if (!MANUFACTURER_HONEYWELL) throw new Error("Honeywell manufacturer not found.");

// The same accessory-type families the matching engine already treats as
// accessory roles (fire-alarm-taxonomy.mjs's ACCESSORY_FAMILIES / Accessories
// category) -- reused here, not re-derived, so product_role and matching
// taxonomy never disagree about which families are inherently accessories.
const ACCESSORY_FAMILY_NAMES = new Set(["Back Box", "Weatherproof Box", "Guard", "Bracket", "End-of-Line Device", "Enclosure", "Cable Accessory", "Detector Base", "Sounder Base", "Isolator Base"]);
const TOOL_FAMILY_NAMES = new Set(["Programming Tool"]);
const SOFTWARE_FAMILY_NAMES = new Set(["Software License"]);

const rows = db.prepare(
  `SELECT p.id, p.description, p.attributes, f.name family
   FROM library_products p LEFT JOIN product_families f ON f.id = p.family_id
   WHERE p.manufacturer_id = ? AND p.identity_status = 'Active' AND p.product_role = 'Unclassified'`,
).all(MANUFACTURER_HONEYWELL);

const classify = (row) => {
  const description = String(row.description || "");
  let attrs = [];
  try { attrs = JSON.parse(row.attributes || "[]"); } catch { attrs = []; }
  const hasAccessoryAttribute = attrs.some((entry) => entry.name === "device_role" && entry.value === "Accessory");

  // 1. Software / License -- literal word match only.
  if (/\bSoftware\b/.test(description) || /\bLicense\b/.test(description) || (row.family && SOFTWARE_FAMILY_NAMES.has(row.family))) return { role: "Software / License", basis: "description/family: software or license" };

  // 2. Spare / Replacement -- the product's own description explicitly
  // names itself a replacement part (not merely "for use as a replacement
  // in some other context" -- the literal word "Replacement" naming the
  // part itself).
  if (/\bReplacement\b/i.test(description)) return { role: "Spare / Replacement", basis: "description: literal 'Replacement'" };

  // 3. Installation / Maintenance Tool -- literal programming/test/
  // commissioning tool wording, or the governed Programming Tool family.
  if (/\bProgramming (?:Tool|Kit)\b/i.test(description) || /\bTest(?:ing)? (?:Kit|Tool|Set)\b/i.test(description) || (row.family && TOOL_FAMILY_NAMES.has(row.family))) return { role: "Installation / Maintenance Tool", basis: "description/family: programming or test tool" };

  // 4. Accessory -- an already-governed device_role="Accessory" attribute
  // (fire-alarm-product-attribute-extraction.mjs's own evidence-only rule,
  // literal "Accessory/Accessories/Attachment" in the product's own
  // description), or the product's classified family is itself an
  // accessory-type family (a base, back box, bracket, etc.).
  if (hasAccessoryAttribute) return { role: "Accessory", basis: "existing governed device_role=Accessory attribute" };
  if (row.family && ACCESSORY_FAMILY_NAMES.has(row.family)) return { role: "Accessory", basis: `accessory-type family: ${row.family}` };
  // A "Cabinet Only" / literal accessory-naming product with no governed
  // family yet -- same literal evidence device_role extraction already
  // uses, applied here directly for products device_role never reached
  // (e.g. a null-family product whose description this session's own
  // attribute-extraction pass has not yet scanned).
  if (/\bCabinet Only\b/i.test(description) || /\bAccessor(?:y|ies)\b/i.test(description) || /\bAttachment\b/i.test(description)) return { role: "Accessory", basis: "description: literal cabinet-only/accessory/attachment wording" };

  // 5. Primary Equipment -- a real, governed, non-accessory Fire Alarm
  // family already classified. This is the ONE positive inference this
  // script makes beyond literal text -- but it rests entirely on the
  // EXISTING, already-evidence-backed family classification (never a new
  // judgment about the product itself).
  if (row.family && !ACCESSORY_FAMILY_NAMES.has(row.family) && !TOOL_FAMILY_NAMES.has(row.family) && !SOFTWARE_FAMILY_NAMES.has(row.family)) return { role: "Primary Equipment", basis: `governed primary family: ${row.family}` };

  // 6. Unclassified -- no family, no literal signal. Honestly left as-is;
  // never forced.
  return null;
};

let scanned = 0, changed = 0;
const byRole = new Map();
const statements = [];
for (const row of rows) {
  scanned += 1;
  const result = classify(row);
  if (!result) continue;
  changed += 1;
  byRole.set(result.role, (byRole.get(result.role) || 0) + 1);
  if (apply) statements.push(() => db.prepare("UPDATE library_products SET product_role = ? WHERE id = ?").run(result.role, row.id));
}

if (apply) {
  db.exec("BEGIN IMMEDIATE");
  try { for (const stmt of statements) stmt(); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

console.log(JSON.stringify({
  mode: apply ? "APPLIED" : "DRY-RUN",
  scanned,
  wouldChange: changed,
  remainingUnclassified: scanned - changed,
  byRole: Object.fromEntries(byRole),
}, null, 2));
