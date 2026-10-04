// RECORD THE GOVERNED FARENHYT NET-PRICE RULE.
//
//   FARENHYT DISCOUNT = 65% OFF LIST     (NET MULTIPLIER = 0.35)
//
// This is an authoritative COMPANY COMMERCIAL decision, not an engineer-entered
// per-project assumption. It is persisted through the existing governed
// `discount_rules` table, not a parallel project-specific mechanism.
//
// SCOPE (deliberately narrow)
//   brand_id = Farenhyt. In this repository Farenhyt and Notifier are separate
//   brands under the SAME Honeywell manufacturer row, so a manufacturer-only rule
//   would silently discount Notifier too. Brand scope is what prevents that.
//   The rule therefore does NOT apply to NOTIFIER, GAMEWELL, GENT or generic
//   Honeywell unless separately governed.
//
// IDEMPOTENT: a content-derived key is stored in `evidence_json`; re-running
// detects the existing row and reports NO-OP instead of inserting a duplicate.
// CONFLICT-SAFE: if another active Farenhyt rule with a different discount
// already exists, nothing is written and COMMERCIAL_RULE_CONFLICT is reported.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const DB = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!DB) { console.error("usage: node scripts/record-farenhyt-net-price-rule.mjs <sqlite> [--apply]"); process.exit(2); }

const BRAND_FARENHYT = "brand_9c537844-7f03-41e4-a863-8730028b254f";
const MFR_HONEYWELL = "manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122";
// The governed 2023 Farenhyt manufacturer price list. Real, evidenced source id.
const SOURCE_2023_FARENHYT = "productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da";
const DISCOUNT_BASIS_POINTS = 6500;                 // 65% off list
const NET_MULTIPLIER = 0.35;                        // 1 - 0.65
// Truthful human actor: server-configured identity wins when present, so the
// recorded commercial decision quotes a real human instead of the fallback
// constant. Defaults preserve existing behavior for unattended runs.
const DECIDED_BY = process.env.APP_HUMAN_ID || "authoritative-commercial-decision";
const APPROVED_BY = process.env.APP_HUMAN_ID || "authoritative-commercial-decision";

const bar = (t) => { console.log("\n" + "=".repeat(100)); console.log(t); console.log("=".repeat(100)); };

bar("GOVERNED FARENHYT NET-PRICE RULE");
console.log(`mode    : ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`discount: ${DISCOUNT_BASIS_POINTS} basis points = ${DISCOUNT_BASIS_POINTS / 100}% off list`);
console.log(`net mult: ${NET_MULTIPLIER}`);
console.log(`scope   : brand_id = ${BRAND_FARENHYT} (Farenhyt), source = ${SOURCE_2023_FARENHYT}`);
console.log("");

const db = new DatabaseSync(DB);

// The migration must be applied before this script can use brand_id.
const cols = db.prepare("SELECT name FROM pragma_table_info('discount_rules')").all().map((r) => r.name);
if (!cols.includes("brand_id")) {
  console.error("  REFUSED: discount_rules has no brand_id column. Apply drizzle/0086_discount_rule_brand_scope.sql first.");
  console.error("  This rule is BRAND-SCOPED on purpose; writing it without brand scope would discount Notifier too.");
  process.exit(3);
}
console.log("  brand_id column present: yes");

// Ensure a governed source-version row exists so source_version_id is meaningful.
// price_source_versions is a governed, currently empty table.
let sourceVersionId = db.prepare("SELECT id FROM price_source_versions WHERE source_id=? AND version_number=1").get(SOURCE_2023_FARENHYT)?.id;
const src = db.prepare("SELECT * FROM product_sources WHERE id=?").get(SOURCE_2023_FARENHYT);
if (!src) { console.error("  REFUSED: the 2023 Farenhyt price-list source is not present."); process.exit(3); }
if (!sourceVersionId) {
  sourceVersionId = `pricesourceversion_${randomUUID()}`;
  if (APPLY) {
    db.prepare(`INSERT INTO price_source_versions
      (id, source_id, version_number, source_type, manufacturer_id, currency, effective_from,
       region, reliability, approval_state, downstream_use, document_id, document_version_id,
       input_fingerprint, uploaded_by, approved_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      sourceVersionId, SOURCE_2023_FARENHYT, 1, src.source_type, MFR_HONEYWELL, src.currency,
      src.effective_from, "KSA", "Current Internal Reference", "Approved", "Costing",
      src.document_id, src.document_version_id, src.checksum, src.created_by, APPROVED_BY);
  }
  console.log(`  source version row     : ${APPLY ? "created" : "would create"} ${sourceVersionId}`);
} else {
  console.log(`  source version row     : existing ${sourceVersionId}`);
}

const EVIDENCE = {
  ruleKey: "farenhyt-net-price-discount-v1",
  brand: "FARENHYT",
  brandRelationship: "IN_HOUSE",
  pricingBasis: "APPLICABLE_FARENHYT_LIST_PRICE",
  discountBasisPoints: DISCOUNT_BASIS_POINTS,
  discountPercent: 65,
  netMultiplier: NET_MULTIPLIER,
  authority: "COMMERCIAL",
  statement:
    "Authoritative company commercial decision: FARENHYT DISCOUNT = 65% OFF LIST, NET COST MULTIPLIER = 0.35. " +
    "This is company commercial policy, NOT an engineer-entered per-project assumption. The engineer " +
    "performs technical selection, quantity determination, BOM review and technical approval; the " +
    "commercial pricing engine applies this rule automatically.",
  explicitlyNotApplicableTo: ["NOTIFIER", "GAMEWELL", "GENT", "generic HONEYWELL"],
  sourceDateUnchanged: src.effective_from,
  note:
    "The 2023 source publication date is preserved as-is and is NOT treated as invalidated by this rule. " +
    "The rule supplies the missing Manufacturer List -> Internal Net Cost transformation only.",
};
const RULE_KEY = EVIDENCE.ruleKey;

// Conflict check: any OTHER active Farenhyt rule with a different discount.
const activeFarenhyt = db.prepare(
  "SELECT id, discount_basis_points, effective_from, effective_to, version_number FROM discount_rules WHERE brand_id=? AND approval_state='Approved' AND superseded_at IS NULL"
).all(BRAND_FARENHYT);
const existing = db.prepare("SELECT id, discount_basis_points, evidence_json FROM discount_rules WHERE brand_id=? AND evidence_json LIKE ? LIMIT 1")
  .get(BRAND_FARENHYT, `%${RULE_KEY}%`);

if (existing) {
  console.log(`  [NO-OP] rule already recorded: ${existing.id} (${existing.discount_basis_points} bp)`);
} else {
  const conflicts = activeFarenhyt.filter((r) => r.discount_basis_points !== DISCOUNT_BASIS_POINTS);
  if (conflicts.length) {
    console.log("  COMMERCIAL_RULE_CONFLICT -- another active Farenhyt rule has a different discount:");
    for (const c of conflicts) console.log(`      ${c.id}  ${c.discount_basis_points} bp  v${c.version_number}  ${c.effective_from} -> ${c.effective_to}`);
    console.log("  NOTHING WRITTEN. Resolution requires a human decision (supersede or cancel the prior rule).");
    db.close();
    process.exit(4);
  }
  // Effective date: no commercial effective date was supplied. Use the governed
  // decision timestamp rather than fabricating a retroactive commercial date.
  const effectiveFrom = new Date().toISOString();
  if (APPLY) {
    db.prepare(`INSERT INTO discount_rules
      (id, manufacturer_id, brand_id, source_id, source_version_id, family_scope, component_scope,
       discount_basis_points, calculation_method, calculation_order, effective_from, effective_to,
       project_id, approval_state, evidence_json, version_number, created_by, approved_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `discountrule_${randomUUID()}`, MFR_HONEYWELL, BRAND_FARENHYT, SOURCE_2023_FARENHYT, sourceVersionId,
      "ALL_FARENHYT", "Material Only", DISCOUNT_BASIS_POINTS, "LIST_PRICE_MINUS_PERCENTAGE", 10,
      effectiveFrom, null, null, "Approved", JSON.stringify(EVIDENCE), 1, DECIDED_BY, APPROVED_BY);
    console.log(`  [WROTE] Farenhyt rule: ${DISCOUNT_BASIS_POINTS} bp off list, net multiplier ${NET_MULTIPLIER}`);
    console.log(`          effective_from = ${effectiveFrom} (governed decision timestamp; no commercial date was supplied)`);
  } else {
    console.log(`  [DRY]  would write Farenhyt rule: ${DISCOUNT_BASIS_POINTS} bp, effective_from ${effectiveFrom}`);
  }
}
db.close();
console.log("");
console.log("  No source price row was modified. The list price remains the list price;");
console.log("  the net cost is always a DERIVED value carrying this rule's provenance.");