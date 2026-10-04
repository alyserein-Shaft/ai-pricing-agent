// AL MOUSA FIRE ALARM -- FROZEN COMMERCIAL BOM, PROGRESSIVE COSTING, COVERAGE.
//
// Entry point to COMMERCIAL execution. The technical BOM is frozen (no product
// re-selection). This script:
//
//   1. derives quantities from the CANONICAL BOQ CENSUS, never from a hard-coded
//      table, and reports any line where the governed selection does not cover
//      the BOQ quantity;
//   2. searches the governed price sources in the required order and applies the
//      costing-eligibility rule STRICTLY;
//   3. calculates progressive material cost in SAR, keeping APPROVED cost and
//      UNAPPROVED indicative reference value in separate totals;
//   4. reports commercial coverage and the next work queue.
//
// SINGLE SOURCE OF TRUTH
// -----------------------
// The BOM below is imported from scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs,
// which is the same list the supplier RFQ is generated from. There is deliberately
// NO inline copy here: a second list would let "what we cost" and "what we asked a
// supplier for" drift apart, which is a defect this file previously had.
//
// HARD COMMERCIAL RULES ENFORCED HERE
//   * SAR is the project costing currency. SAR -> SAR 1:1. USD -> SAR uses the
//     single approved fixed rate read from pricing_exchange_rates. Any other
//     currency FAILS CLOSED.
//   * An unknown price is never zero. An unknown quantity is never zero. A pending
//     line is reported and EXCLUDED from cost, never valued.
//   * LIST PRICE, SUPPLIER DISCOUNT, NET MATERIAL COST and SELLING PRICE are
//     distinct. A discount applies only where a governed rule supports it.
//   * A family alias without an exact orderable P/N cannot enter Price Library.
//   * Lifecycle / KSA availability is a WARNING, never a block.
import { DatabaseSync } from "node:sqlite";
import { BOM, INCLUDED_LINES, assertCensus } from "./lib/al-mousa-fire-alarm-commercial-bom.mjs";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/freeze-al-mousa-fire-alarm-commercial-bom.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });

// ---------------------------------------------------------------------------
// 1. Currency policy -- READ from the approved rate, never hard-coded.
// ---------------------------------------------------------------------------
const rate = db.prepare("SELECT * FROM pricing_exchange_rates WHERE from_currency='USD' AND to_currency='SAR' AND approval_status='Approved'").get();
const USD_SAR = rate ? Number(rate.rate) : null;
const PROJECT_CCY = "SAR";

const convert = (amountMinor, currency) => {
  if (currency === PROJECT_CCY) return { sar: amountMinor, ok: true, basis: "1:1 (project costing currency)" };
  if (currency === "USD") {
    if (USD_SAR === null) return { sar: null, ok: false, basis: "no approved USD->SAR rate" };
    return { sar: Math.round(amountMinor * USD_SAR), ok: true, basis: `x ${USD_SAR} (${rate.rate_type}, approved)` };
  }
  return { sar: null, ok: false, basis: `unsupported currency ${currency} -- requires review, not auto-converted` };
};

// ---------------------------------------------------------------------------

// 2. Census assertion. Quantities were derived from the canonical BOQ census when

//    the shared module was loaded, and verified there before any commercial use.

// ---------------------------------------------------------------------------

const censusCheck = assertCensus();

console.log(`canonical census   : ${censusCheck.lines} lines, all ${censusCheck.verified} derived quantities VERIFIED against the census`);



// ---------------------------------------------------------------------------

// 3. The frozen commercial BOM. Identity, manufacturer, role and quantity all come

//    from the shared module -- the same list the RFQ is built from. Included panel

//    hardware is carried separately and is never separately priced.

// ---------------------------------------------------------------------------

const BOM_LINES = [...BOM.map((l) => ({ ...l })), ...INCLUDED_LINES.map((l) => ({ ...l, included: true }))];

// ---------------------------------------------------------------------------
// 4. Price search across the governed sources, in the required order.
//    C1 project supplier quotation -> C2 project price list -> C3 price library.
// ---------------------------------------------------------------------------
const identityIds = (pn) => db.prepare("SELECT id FROM product_identities WHERE UPPER(normalized_product_code)=UPPER(?)").all(pn).map((r) => r.id);

function gatherPrices(pn) {
  const out = [];
  // C3a -- price_records (the governed Price Library)
  for (const r of db.prepare("SELECT pr.* FROM price_records pr JOIN library_products p ON p.id=pr.product_id WHERE UPPER(p.part_number)=UPPER(?)").all(pn)) {
    out.push({ tier: "C3", sys: "price_records", amt: r.amount_minor, ccy: r.currency, type: r.price_type, appr: r.approval_status, use: r.downstream_use, val: r.validity_state, eff: r.effective_from, until: r.valid_until, src: safeJson(r.source_location), net: r.discount_basis_points != null });
  }
  // C2/C3b -- product_identity_prices, annotated with the knowledge file it came from
  const ids = identityIds(pn);
  if (ids.length) {
    const rows = db.prepare(`SELECT pip.*, kf.file_name fn FROM product_identity_prices pip
        JOIN knowledge_facts f ON f.id = pip.knowledge_fact_id
        JOIN knowledge_files kf ON kf.id = f.knowledge_file_id
        WHERE pip.product_identity_id IN (${ids.map(() => "?").join(",")})`).all(...ids);
    for (const r of rows) out.push({ tier: "C2", sys: "identity_prices", amt: r.price_amount, ccy: r.currency, type: r.price_type, appr: null, use: r.costing_eligible ? "Costing" : null, val: r.discovery_status, eff: r.effective_date, until: r.validity, src: { ...safeJson(r.source_location), fileName: r.fn } });
  }
  return out;
}
function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

// The cost of a strict eligibility test, stated so nobody mistakes the number.
const COSTING_ELIGIBLE = (p) => p.use === "Costing";
const findingsFor = (ps) => {
  const d = new Set();
  for (const p of ps) {
    if (p.use !== "Costing") d.add("DISCOVERY_ONLY");
    if (p.appr && p.appr !== "Approved") d.add("UNAPPROVED");
    if (!p.until || p.until === "Unknown") d.add("MISSING_VALIDITY");
  }
  if (ps.length > 1) d.add("DUPLICATE_PRICE_RECORD");
  if (ps.length > 1 && new Set(ps.map((p) => `${p.ccy}:${p.amt}`)).size > 1) d.add("CROSS_SOURCE_PRICE_CONFLICT");
  return [...d];
};

// Prefer the most current KSA source for the INDICATIVE reference figure, but
// never let that preference upgrade anything to approved.
const indicativePick = (ps) => {
  const y2026 = ps.filter((p) => /2026/.test(String(p.src.fileName || p.src.sheet || "")));
  return y2026[0] || ps.find((p) => /Farenhyt|GENT/i.test(String(p.src.sheet || ""))) || ps[0] || null;
};

const SUPPLIER_DISCOUNT_BP = null; // discount_rules is empty -- see the audit

function evaluate(line) {
  const hasQty = line.qty !== null && line.qty !== undefined;
  const exactPn = !!line.pn && !line.familyAlias && !line.pnCandidates;
  const prices = exactPn ? gatherPrices(line.pn) : [];
  const approved = prices.find(COSTING_ELIGIBLE) || null;
  const indicative = approved ? null : indicativePick(prices);

  let priceState;
  if (!exactPn) priceState = "EXACT_PRODUCT_PENDING";
  else if (approved) priceState = "APPROVED_COSTING_PRICE";
  else if (prices.length) priceState = "PRICE_FOUND_NEEDS_REVIEW";
  else priceState = "PRICE_PENDING";

  let state;
  if (!exactPn) state = "PENDING_EXACT_PN";
  else if (!hasQty) state = "PENDING_QUANTITY";
  else if (approved) state = "READY_FOR_PRICING";
  else state = "READY_FOR_PRICING_WITH_WARNING";

  return { ...line, exactPn, hasQty, prices, approved, indicative, priceState, state, defects: findingsFor(prices) };
}

const results = BOM_LINES.map(evaluate);

// ===========================================================================
console.log("=".repeat(112));
console.log("AL MOUSA FIRE ALARM -- FROZEN COMMERCIAL BOM");
console.log("=".repeat(112));
console.log(`currency policy : project costing currency ${PROJECT_CCY}; SAR->SAR 1:1; USD->SAR x ${USD_SAR} (${rate ? rate.rate_type : "n/a"}); other currencies FAIL CLOSED`);
console.log(`supplier discount: ${SUPPLIER_DISCOUNT_BP === null ? "NONE -- discount_rules is empty, so no discount is applied anywhere" : SUPPLIER_DISCOUNT_BP}`);
console.log(`quantities      : derived from the canonical BOQ census (${censusCheck.lines} lines), not hard-coded`);
console.log("");
for (const r of results) {
  console.log(`  [${r.state}]`.padEnd(40) + r.boq);
  console.log(`      manufacturer : ${r.mfr}   lifecycle: ${r.lifecycle ?? "n/a"}` + (r.lifecycle && r.lifecycle !== "CURRENT" ? "  -> availability WARNING, never a block" : ""));
  console.log(`      model / P/N  : ${r.pn ?? (r.familyAlias ? `FAMILY ALIAS "${r.familyAlias}" -- not an orderable code` : "PENDING")}`);
  console.log(`      quantity     : ${r.qty ?? r.pending}`);
  if (r.boqQty != null && r.qty != null && r.qty !== r.boqQty) console.log(`      COVERAGE GAP : governed ${r.qty} vs census ${r.boqQty}  (${r.boqQty - r.qty} unaccounted)`);
  if (r.note) console.log(`      note         : ${r.note}`);
  if (r.warning) console.log(`      warning      : ${r.warning}`);
  if (r.rule) console.log(`      rule         : ${r.rule}`);
  console.log(`      BOM role     : ${r.role}`);
  console.log(`      price state  : ${r.priceState}${r.defects.length ? `   defects: ${r.defects.join(", ")}` : ""}`);
  for (const p of r.prices) console.log(`         - ${String(p.amt).padStart(9)} ${String(p.ccy).padEnd(4)} ${String(p.type).padEnd(28)} use=${String(p.use).padEnd(12)} src=${p.src.sheet || p.src.fileName || "?"}`);
  console.log("");
}

// ===========================================================================
// 5. Progressive costing. APPROVED and UNAPPROVED are never combined.
// ===========================================================================
let approvedMinor = 0, approvedLines = 0;
let indicativeMinor = 0, indicativeLines = 0;
const excluded = [];
const coverage = { APPROVED_COSTING_PRICE: 0, PRICE_FOUND_NEEDS_REVIEW: 0, PRICE_PENDING: 0, EXACT_PRODUCT_PENDING: 0, QUANTITY_PENDING: 0 };

console.log("=".repeat(112));
console.log("PROGRESSIVE MATERIAL COSTING");
console.log("=".repeat(112));
console.log("  BOQ item".padEnd(44) + "P/N".padEnd(13) + "Qty".padStart(5) + "Unit SAR".padStart(12) + "Extended SAR".padStart(15) + "  Price state");
console.log("  " + "-".repeat(110));
for (const r of results) {
  if (r.included) { excluded.push({ r, why: "INCLUDED with each N16 -- never separately priced" }); continue; }
  if (r.state === "PENDING_EXACT_PN") { excluded.push({ r, why: `exact orderable P/N not selected (${r.pending})` }); coverage.EXACT_PRODUCT_PENDING += 1; continue; }
  if (r.state === "PENDING_QUANTITY") { excluded.push({ r, why: `quantity ${r.pending}` }); coverage.QUANTITY_PENDING += 1; continue; }

  if (r.approved) {
    const conv = convert(r.approved.amt, r.approved.ccy);
    if (conv.ok) {
      const ext = conv.sar * r.qty;
      approvedMinor += ext; approvedLines += 1; coverage.APPROVED_COSTING_PRICE += 1;
      console.log(`  ${r.boq}`.padEnd(44) + `${r.pn}`.padEnd(13) + String(r.qty).padStart(5) + `  ${(conv.sar / 100).toFixed(2)}`.padStart(12) + `  ${(ext / 100).toFixed(2)}`.padStart(15) + "  APPROVED");
      continue;
    }
  }
  // Not approved. Keep the reference value strictly separate, or stay PENDING.
  if (r.indicative) {
    const conv = convert(Math.round(r.indicative.amt * 100), r.indicative.ccy); // identity prices are major units
    if (conv.ok) {
      const ext = conv.sar * r.qty;
      indicativeMinor += ext; indicativeLines += 1; coverage.PRICE_FOUND_NEEDS_REVIEW += 1;
      console.log(`  ${r.boq}`.padEnd(44) + `${r.pn}`.padEnd(13) + String(r.qty).padStart(5) + `  ${(conv.sar / 100).toFixed(2)}`.padStart(12) + `  ${(ext / 100).toFixed(2)}`.padStart(15) + "  UNAPPROVED reference");
      continue;
    }
  }
  excluded.push({ r, why: `price not usable -- ${r.priceState}` });
  coverage.PRICE_PENDING += 1;
  console.log(`  ${r.boq}`.padEnd(44) + `${r.pn}`.padEnd(13) + String(r.qty).padStart(5) + "   PENDING".padStart(12) + "     PENDING".padStart(15) + `  ${r.priceState}`);
}
console.log("  " + "-".repeat(110));
console.log("");
console.log(`  APPROVED MATERIAL COST SUBTOTAL (${PROJECT_CCY})          : ${(approvedMinor / 100).toFixed(2)}   from ${approvedLines} line(s)`);
console.log(`  UNAPPROVED indicative reference value, NOT cost (${PROJECT_CCY}) : ${(indicativeMinor / 100).toFixed(2)}   from ${indicativeLines} line(s), EXCLUDED from the subtotal`);
console.log("");
console.log("  Neither figure is the total Fire Alarm material cost. Pending lines are excluded and");
console.log("  unvalued, never booked at zero. The indicative figure is an unapproved reference from");
console.log("  catalogue sources and must not be quoted, totalled, or presented as a cost.");
console.log("");
console.log("  EXCLUDED LINES (kept visible, never valued)");
for (const { r, why } of excluded) console.log(`    - ${r.boq} :: ${why}`);

// ===========================================================================
// 6. Commercial coverage
// ===========================================================================
console.log("");
console.log("=".repeat(112));
console.log("COMMERCIAL COVERAGE");
console.log("=".repeat(112));
console.log(`  total commercial BOM lines            : ${results.length}  (the same list the supplier RFQ is generated from)`);
for (const [k, v] of Object.entries(coverage)) console.log(`  ${k.padEnd(36)} ${v}`);
console.log(`  included, never separately priced    : ${results.filter((r) => r.included).length}`);
const approvable = results.filter((r) => !r.included && r.exactPn && r.hasQty).length;
console.log(`  approved priced line coverage        : ${approvedLines} of ${approvable} costable-eligible lines`);
console.log("");
console.log("  NEXT COMMERCIAL WORK QUEUE -- priced lines needing only an APPROVAL decision:");
for (const r of results.filter((x) => x.priceState === "PRICE_FOUND_NEEDS_REVIEW" && !x.included && x.hasQty)) console.log(`      ${r.pn.padEnd(12)} x${String(r.qty).padStart(5)}  ${r.boq}`);
console.log("");
console.log("  NEXT COMMERCIAL WORK QUEUE -- lines with NO price at all:");
for (const r of results.filter((x) => x.priceState === "PRICE_PENDING" && !x.included && x.hasQty)) console.log(`      ${r.pn.padEnd(12)} x${String(r.qty).padStart(5)}  ${r.boq}`);
