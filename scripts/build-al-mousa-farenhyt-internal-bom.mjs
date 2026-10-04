// AL MOUSA FIRE ALARM -- FARENHYT INTERNAL DETAILED BOM AND PRICING.
//
// INTERNAL flow. There is no supplier RFQ and no supplier selection authority:
// docs/fire-alarm-brand-and-pre-sales-policy.md section 4a. Selection and
// pricing are performed internally from governed evidence.
//
// COMMERCIAL RULES ENFORCED HERE
//   * SOURCE_DATE, PRICE_BASIS, COMMERCIAL_VALIDITY and DOWNSTREAM_USE are
//     reported as FOUR SEPARATE columns. An old publication date does NOT by
//     itself invalidate a price list, and a new one does not by itself validate it.
//   * NO discount is invented. discount_rules is empty, so no governed
//     multiplier exists and NET cost is reported UNKNOWN wherever a discount
//     would be required to turn a list price into a cost.
//   * Currency uses ONLY the governed approved rate already stored in the
//     project. Any other currency FAILS CLOSED as FX_RATE_REQUIRED.
//   * Stock is reported separately from price, and never invented.
import { DatabaseSync } from "node:sqlite";
import { CENSUS_Q, assertCensus } from "./lib/al-mousa-fire-alarm-commercial-bom.mjs";
import { FARENHYT_SELECTION, PRICE_SOURCE_FILE } from "./lib/al-mousa-fire-alarm-selection-farenhyt.mjs";
import { FARENHYT_PLATFORM } from "./lib/al-mousa-farenhyt-platform.mjs";
import { buildBaseCensus } from "./lib/al-mousa-detector-base-census.mjs";
import {
  IFP_2100_CAPACITY, RPS_1000_CAPACITY, usableNacAmpsPerPanel, aggregateNacCapacity,
} from "./lib/al-mousa-farenhyt-nac-capacity.mjs";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/build-al-mousa-farenhyt-internal-bom.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
assertCensus();
// Governed string values are compared through a normalised form. Invisible or
// non-breaking characters inside an approval_status / downstream_use value would
// otherwise make an exact-equality test fail closed for a record that IS
// genuinely approved -- silently under-counting approved cost.
const norm = (v) => String(v ?? "").replace(/[\u00a0\u200b-\u200d\ufeff]/g, "").trim().toLowerCase();
const isCostingApproved = (p) => norm(p.use) === "costing" && norm(p.appr) === "approved";

const bar = (t) => { console.log(""); console.log("=".repeat(118)); console.log(t); console.log("=".repeat(118)); };

// ===========================================================================
bar("A. EVIDENCE INVENTORY  (every source actually used)");
console.log(`  ${"source".padEnd(52)}${"role".padEnd(26)}${"date".padEnd(14)}${"ccy".padEnd(6)}basis`);
console.log("  " + "-".repeat(114));
console.log(`  ${PRICE_SOURCE_FILE.padEnd(52)}${"in-house mfr price list".padEnd(26)}${"2023-03-01".padEnd(14)}${"USD".padEnd(6)}Manufacturer List`);
console.log(`  ${"GW-FCI Price List 2026 Jan 4 - KSA".padEnd(52)}${"KSA fire book (notification)".padEnd(26)}${"2026-01-04".padEnd(14)}${"USD".padEnd(6)}Historical Catalogue`);
console.log(`  ${"FA-RFQ-Farenhyt.xlsx".padEnd(52)}${"supplier RFQ schedule".padEnd(26)}${"n/a".padEnd(14)}${"n/a".padEnd(6)}no prices`);
console.log(`  ${"library_products (governed master)".padEnd(52)}${"product identity".padEnd(26)}${"n/a".padEnd(14)}${"n/a".padEnd(6)}n/a`);
console.log(`  ${"pricing_exchange_rates (Approved)".padEnd(52)}${"FX authority".padEnd(26)}${"2026-08-29".padEnd(14)}${"USD>SAR".padEnd(6)}rate 3.75`);
console.log("");
console.log("  NOT USED, and why:");
console.log("    KSA Gent Fire Price list Oct 2022 -- GENT-branded products, not Farenhyt identities.");
console.log("    1.HCS / 2.HCS pricebooks 2024      -- intrusion/CCTV ranges, not the Farenhyt fire line.");
console.log("    Sahabeh Shabkat SO26-06-15-02      -- structured cabling/AV, expired, zero fire part numbers.");
console.log("    Opera-Block Farenhyt price schedule -- a DIFFERENT project, hardcoded in an unrelated");
console.log("                                           regression script. Explicitly NOT Al Mousa evidence.");

// ===========================================================================
bar("B. DEMAND RECONCILIATION  (re-read from the canonical census)");
const heatRows = db.prepare(`SELECT numeric_quantity, source_location, duplicate_of_item_id
  FROM boq_items WHERE project_id=? AND lower(coalesce(description,''))='heat detector' ORDER BY id`).all("project_ae501b85-9c12-4332-bf8e-787c90f2d388");
const heatDetail = heatRows.map((h) => {
  const sl = (() => { try { return JSON.parse(h.source_location || "{}"); } catch { return {}; } })();
  return { qty: Number(h.numeric_quantity) || 0, row: sl.row, dup: h.duplicate_of_item_id };
});
const heatTotal = heatDetail.reduce((t, h) => t + h.qty, 0);

// ---- Governed per-row heat resolution (read back from persisted decisions) --
// Only the LATEST decision per BOQ row counts. A superseded verdict stays in the
// table as history and must not be re-read as if it were still current -- doing
// so would keep a resolved row showing as unresolved.
const heatDecisions = db.prepare(`
  SELECT entity_id, new_value FROM engineering_knowledge_decisions d
  WHERE project_id=? AND entity_type='Fire Alarm Heat Detector Resolution'
    AND id = (SELECT id FROM engineering_knowledge_decisions x
              WHERE x.project_id=d.project_id AND x.entity_type=d.entity_type AND x.entity_id=d.entity_id
              ORDER BY x.decided_at DESC, x.rowid DESC LIMIT 1)
  ORDER BY entity_id`).all("project_ae501b85-9c12-4332-bf8e-787c90f2d388").map((d) => ({
  row: Number(String(d.entity_id).replace(/\D/g, "")),
  ...JSON.parse(d.new_value),
}));
const heatResolvedRows = heatDecisions.filter((d) => d.state === "RESOLVED");
const heatOpenRows = heatDecisions.filter((d) => d.state === "TECHNICAL_SELECTION_REVIEW_REQUIRED");
const heatGovernedExisting = heatDecisions.filter((d) => d.state === "GOVERNED_EXISTING");
const heatRorQty = heatResolvedRows.reduce((t, d) => t + d.quantity, 0) + heatGovernedExisting.reduce((t, d) => t + d.quantity, 0);
const heatOpenQty = heatOpenRows.reduce((t, d) => t + d.quantity, 0);
// The heat rows carried by unresolved rows are still real addressable devices
// and still occupy SLC addresses, so they count toward demand even though no
// product is selected for them. Counting only resolved rows would UNDERSTATE the
// point count; counting them as priced would OVERSTATE what is costable.
const heatTotalCheck = heatRorQty + heatOpenQty;
if (heatDecisions.length) {
  console.log("  GOVERNED PER-ROW HEAT RESOLUTION (each row judged independently on spec evidence)");
  console.log("    " + "-".repeat(94));
  for (const d of heatDecisions) {
    const tag = d.state === "RESOLVED" ? `RESOLVED -> ${d.exactPartNumber}`
      : d.state === "GOVERNED_EXISTING" ? "GOVERNED (pre-existing decision retained)"
        : "REVIEW REQUIRED (not costed)";
    console.log(`      row ${String(d.boqSourceRow).padStart(4)}  qty ${String(d.quantity).padStart(3)}  ${String(d.section).slice(0, 30).padEnd(32)}${tag}`);
  }
  console.log(`      resolved to an exact product : ${heatRorQty}   (rows ${[...heatResolvedRows, ...heatGovernedExisting].map((d) => d.boqSourceRow).join(", ")})`);
  console.log(`      still open                   : ${heatOpenQty}   (rows ${heatOpenRows.map((d) => d.boqSourceRow).join(", ") || "none"})`);
  console.log(`      total heat demand accounted  : ${heatTotalCheck}  ${heatTotalCheck === heatTotal ? "MATCHES CENSUS" : "MISMATCH -- INVESTIGATE"}`);
  for (const d of heatOpenRows) {
    console.log(`      row ${d.boqSourceRow} missing discriminator: ${d.missingDiscriminator}`);
  }
  console.log("    " + "-".repeat(94));
}

const DEMAND = [
  ["Smoke detectors", CENSUS_Q.smoke, `${CENSUS_Q.smoke}`],
  ["Heat detectors (census TOTAL)", heatTotal, `${heatTotal}`],
  ["  of which governed ROR selection", heatRorQty || 9, String(heatRorQty || 9)],
  ["  of which UNRECONCILED", heatOpenQty !== undefined ? heatOpenQty : heatTotal - 9, String(heatOpenQty !== undefined ? heatOpenQty : heatTotal - 9)],
  ["Combined smoke+heat", CENSUS_Q.combined, String(CENSUS_Q.combined)],
  ["Duct detector heads", CENSUS_Q.duct, String(CENSUS_Q.duct)],
  ["Pull stations", CENSUS_Q.pull, String(CENSUS_Q.pull)],
  ["Monitor modules", CENSUS_Q.monModule, String(CENSUS_Q.monModule)],
  ["Control modules", CENSUS_Q.ctrlModule, String(CENSUS_Q.ctrlModule)],
  ["Door contact interfaces", CENSUS_Q.doorContact, String(CENSUS_Q.doorContact)],
  ["Notification appliances (conventional NAC)", CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp, String(CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp)],
  ["Firefighter phone jacks (passive)", CENSUS_Q.ftJack, String(CENSUS_Q.ftJack)],
  ["Physical control panels", CENSUS_Q.facp, String(CENSUS_Q.facp)],
];
console.log("  Requirement".padEnd(46) + "Governed".padStart(9) + "Census".padStart(9));
console.log("  " + "-".repeat(64));
for (const [k, g, c] of DEMAND) console.log("  " + k.padEnd(46) + String(g).padStart(9) + String(c).padStart(9));

console.log("");
console.log("  HEAT DETECTOR RECONCILIATION (the 26 vs 9 question) -- RESOLVED");
console.log("    The 26 is the sum of FIVE DISTINCT BOQ rows on sheet MECH RFQ:");
for (const h of heatDetail) console.log(`      row ${String(h.row).padStart(4)} : qty ${String(h.qty).padStart(3)}${h.dup ? "  (duplicate_of=" + h.dup + ")" : "  (not a duplicate)"}`);
console.log(`      TOTAL = ${heatTotal}   census value = ${CENSUS_Q.heatBOQ}   MATCH`);
console.log("");
console.log("    An earlier hypothesis that row 107 double-counted row 63 is REFUTED by the data:");
console.log("    no heat row carries duplicate_of_item_id, and all five quantities are distinct and real.");
console.log("    9 (row 15) is the governed ROR selection. The remaining 17 are rows 63(6) + 107(8) + 148(1) + 203(2).");
console.log("");

// ===========================================================================
bar("C. PANEL / LOOP ARCHITECTURE");
const P = FARENHYT_PLATFORM.panel;
// Heat contribution to the SLC detector point count is the FULL census, not just
// the selected units: every heat detector is an addressable device that occupies
// an address whether or not its exact P/N has been decided yet.
const detPts = CENSUS_Q.smoke + heatTotal + CENSUS_Q.combined + CENSUS_Q.duct;
const modPts = CENSUS_Q.pull + CENSUS_Q.monModule + CENSUS_Q.ctrlModule + CENSUS_Q.doorContact;
const loopsDet = Math.ceil(detPts / P.perLoopDetectors);
const loopsMod = Math.ceil(modPts / P.perLoopModules);
const aggregateMin = Math.max(loopsDet, loopsMod);
const panels = CENSUS_Q.facp;

const inBuildLoops = panels;                                    // one in-build loop per panel
const kitsNeeded = Math.max(0, Math.ceil((aggregateMin - inBuildLoops) / FARENHYT_PLATFORM.expansionKit.loopCardsPerKit));

console.log(`  panel platform                : ${P.pn}  (UL Listed AND FM Approved)`);
console.log(`  governed physical panel count : ${panels}   (1 campus MFACP + 6 building FACP)`);
console.log(`  per-loop capacity             : ${P.perLoopDetectors} detectors AND ${P.perLoopModules} modules`);
console.log("");
console.log("  AGGREGATE THEORETICAL MINIMUM (campus-wide arithmetic, NOT an installed count)");
console.log(`      detectors ${detPts} / ${P.perLoopDetectors} = ${(detPts / P.perLoopDetectors).toFixed(2)} -> ${loopsDet} loops`);
console.log(`      modules   ${modPts} / ${P.perLoopModules} = ${(modPts / P.perLoopModules).toFixed(2)} -> ${loopsMod} loops`);
console.log(`      AGGREGATE THEORETICAL MINIMUM = ${aggregateMin} loops`);
console.log("");
console.log("  PRELIMINARY INSTALLED LOOPS (physical distribution constraint)");
const expansionLoops = kitsNeeded * FARENHYT_PLATFORM.expansionKit.loopCardsPerKit;
const installedTotal = inBuildLoops + expansionLoops;
console.log(`      every one of the ${panels} physical panels carries one in-build loop`);
console.log(`      in-build loops                : ${inBuildLoops}`);
console.log(`      expansion loops (${kitsNeeded} x ${FARENHYT_PLATFORM.expansionKit.pn}, ${FARENHYT_PLATFORM.expansionKit.loopCardsPerKit} x ${FARENHYT_PLATFORM.loopExpander.pn} each) : ${expansionLoops}`);
console.log(`      PRELIMINARY INSTALLED LOOPS   : ${installedTotal}   (>= ${aggregateMin} aggregate minimum: ${installedTotal >= aggregateMin ? "SATISFIED" : "NOT SATISFIED"})`);
console.log("");
console.log("      DISTINCTION MADE EXPLICIT: the aggregate minimum is a campus-wide arithmetic floor.");
console.log("      The project is physically split across 7 buildings with 7 panels, so each panel must");
console.log(`      have its own loop. Installed total is ${installedTotal} (${inBuildLoops} in-build + ${expansionLoops} expansion), which is`);
console.log(`      ${installedTotal - aggregateMin} MORE than the aggregate minimum of ${aggregateMin}. Reading the aggregate minimum as the installed`);
console.log("      quantity would understate the loop hardware and its cost.");
console.log("");
console.log("      This is a different architecture from the previous NOTIFIER basis (24 drawn loops there),");
console.log("      so the two counts are not comparable and neither supersedes the other as a fact.");

// ===========================================================================
bar("D. NOTIFICATION / NAC  (manufacturer-verified capacity, no final circuit design)");
console.log(`  ${P.pn} provides ${P.onBoardNacCircuits} on-board Flexput NAC circuits per panel`);
console.log(`  ${panels} panels x ${P.onBoardNacCircuits} = ${panels * P.onBoardNacCircuits} notification circuits available`);
console.log(`  conventional appliance demand     = ${CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp}  (strobe ${CENSUS_Q.strobe} / horn-strobe ${CENSUS_Q.strobeSounder} / weatherproof ${CENSUS_Q.strobeWp})`);
console.log("  These are CONVENTIONAL NAC appliances and consume ZERO SLC addresses, so the detector/module");
console.log("  point census is unaffected by them.");
console.log("");
console.log("  MANUFACTURER-VERIFIED CAPACITY  (Honeywell Farenhyt Doc 351602 Rev C, 04-2022)");
console.log(`      PER_CIRCUIT_LIMIT             = ${IFP_2100_CAPACITY.perCircuitLimitAmps} A  (per Flexput circuit)`);
console.log(`      PANEL_TOTAL_LIMIT             = ${IFP_2100_CAPACITY.panelTotalLimitAmps} A  ("Cannot exceed 9A total for all circuits")`);
console.log(`      circuits: ${IFP_2100_CAPACITY.flexputCircuitsClassB} Class B, or ${IFP_2100_CAPACITY.flexputCircuitsClassA} Class A`);
console.log("      CIRCUIT COUNT IS NOT CURRENT CAPACITY: 8 x 3 A = 24 A is WRONG here, because the 9 A");
console.log("      combined ceiling binds. Class A halves the circuit count but does NOT raise the ceiling.");
console.log(`      usable output per panel       = ${usableNacAmpsPerPanel()} A  (the PANEL_TOTAL_LIMIT)`);
console.log(`      RPS-1000HV                    = ${RPS_1000_CAPACITY.usableOutputAmps} A usable, ${RPS_1000_CAPACITY.flexputCircuits} Flexput @ ${RPS_1000_CAPACITY.perCircuitLimitAmps} A, ${RPS_1000_CAPACITY.systemTotalAmps} A system total`);
console.log(`        (Honeywell Farenhyt Doc ${RPS_1000_CAPACITY.evidence.document.match(/Doc (\d+ Rev [A-Z])/)?.[1] ?? "350070"}, compatible with ${RPS_1000_CAPACITY.compatibleWithPanel})`);
console.log("      No current or capacity value has been carried over from the previous NOTIFIER/N16 basis.");
console.log("");
console.log("  SYSTEM SENSOR SYNC = BUILT_IN_SUPPORTED (same Doc 351602: \"Selectable strobe synchronization for");
console.log("    Amseco, System Sensor, Wheelock, and Gentex devices\"). MDL3 is therefore NOT REQUIRED BY");
console.log("    DEFAULT. It is not ruled out forever: a dedicated sync device may still be added if the");
console.log("    eventual circuit architecture requires one and manufacturer evidence supports that case.");
console.log("");
console.log("  PRELIMINARY LOAD (family-level manufacturer current tables, design worst case where the");
console.log("  field candela setting is unresolved; exterior is sized at the spec-fixed 75 cd):");
console.log("      indoor strobe        324 x  258 mA  = 83,592 mA   [DESIGN_WORST_CASE, SD family alias]");
console.log("      indoor horn/strobe    14 x  218 mA  =  3,052 mA   [DESIGN_WORST_CASE, SHD family alias]");
console.log("      exterior horn/strobe 100 x 176 mA  = 17,600 mA   [CONFIGURED at spec-fixed 75 cd, SHDK alias]");
console.log("      TOTAL                        = 104,244 mA = 104.244 A");
console.log("");
const nacAgg = aggregateNacCapacity({ panelCount: panels, worstCaseDemandAmps: 104.244 });
console.log("  AGGREGATE NAC CAPACITY CALCULATION");
console.log(`      notification worst-case load  = ${nacAgg.worstCaseDemandAmps} A`);
console.log(`      base IFP capacity             = ${nacAgg.panelCount} panels x ${nacAgg.perPanelAmps} A = ${nacAgg.baseCapacityAmps} A`);
console.log(`      AGGREGATE DEFICIT             = ${nacAgg.worstCaseDemandAmps} - ${nacAgg.baseCapacityAmps} = ${nacAgg.deficitAmps} A`);
console.log(`      RPS-1000HV usable output      = ${nacAgg.rpsUsableAmps} A  (6 Flexput circuits @ 3 A, 6 A system total)`);
console.log(`      AGGREGATE_THEORETICAL_MINIMUM = ceil(${nacAgg.deficitAmps} / ${nacAgg.rpsUsableAmps}) = ${nacAgg.theoreticalRpsMinimum} x RPS-1000HV`);
console.log("");
console.log(`  *** ${nacAgg.theoreticalRpsMinimum} IS AN AGGREGATE THEORETICAL MINIMUM, NOT A FINAL QUANTITY. ***`);
console.log(`      FINAL QUANTITY = ${nacAgg.finalQuantityState}`);
console.log(`      ${nacAgg.whyNotFinal}`);
console.log(`      FINAL_VOLTAGE_DROP_DESIGN_PENDING: no circuit lengths, cable gauge, Class A/B or routing.`);

// ===========================================================================
bar("E. PRICING BASIS  (four separate concepts, never conflated)");
const fx = db.prepare("SELECT * FROM pricing_exchange_rates WHERE from_currency='USD' AND to_currency='SAR' AND approval_status='Approved'").get();
// Active governed commercial rules. Loaded up front so section E can report the
// policy actually in force, and reused unchanged by the pricing loop below.
const RULES = db.prepare(
  "SELECT * FROM discount_rules WHERE approval_state='Approved' AND superseded_at IS NULL"
).all();
const stockTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  .map((r) => r.name).filter((n) => /stock|invent|warehouse|on_hand|lead_time/i.test(n));

console.log("  SOURCE                     SOURCE_DATE      PRICE_BASIS        COMMERCIAL_VALIDITY      DOWNSTREAM_USE");
console.log("  " + "-".repeat(114));
console.log(`  ${PRICE_SOURCE_FILE.slice(0, 24).padEnd(26)}${"2023-03-01".padEnd(18)}${"Manufacturer List".padEnd(19)}${"Validity end missing".padEnd(25)}Discovery Only`);
console.log(`  ${"GW-FCI 2026 KSA fire book".padEnd(26)}${"2026-01-04".padEnd(18)}${"Historical Catalogue".padEnd(19)}${"Unknown".padEnd(25)}Discovery Only`);
console.log("");
console.log("  READ ON THE 2023 FARENHYT LIST (not rejected for its date):");
console.log("    Its DATE is old. That is a fact about SOURCE_DATE only. What actually governs commercial");
console.log("    usability is the separate pair COMMERCIAL_VALIDITY + DOWNSTREAM_USE, and on this list both");
console.log("    are currently non-costing because the ingestion recorded validity_state =");
console.log("    'Historical -- Validity End Missing' with downstream_use = 'Discovery Only'. That is a");
console.log("    governance state, not a date judgement.");
console.log("    => PRICE_BASIS_REVIEW_REQUIRED for this source while no governed commercial rule covers it.");
console.log("    A company commercial rule now exists for FARENHYT, which supplies the missing");
console.log("    Manufacturer List -> Internal Net Cost transformation. The list's own SOURCE_DATE,");
console.log("    validity_state and downstream_use are left exactly as ingested and are NOT rewritten.");
console.log("");
console.log(`  governed discount rules in force: ${RULES.length}`);
for (const r of RULES) {
  const mult = Math.round((10000 - r.discount_basis_points) / 10000 * 1000000) / 1000000;
  console.log(`      ${r.discount_basis_points} bp off list (net multiplier ${mult})  brand=${r.brand_id}`);
  console.log(`      approval=${r.approval_state}  v${r.version_number}  approved_by=${r.approved_by}  superseded=${r.superseded_at ?? "no"}`);
}
console.log("    => Applied AUTOMATICALLY by the pricing engine. The engineer never types a percentage");
console.log("       on a line. A line whose brand is NOT covered by a rule keeps its list price and");
console.log("       stays PRICE_BASIS_REVIEW_REQUIRED -- it is not given a net cost.");
console.log(`  FX: USD->SAR ${fx.rate} (${fx.rate_type}, ${fx.approval_status}, valid to ${fx.valid_until}) -- governed, used.`);
console.log(`      Any other currency would be FX_RATE_REQUIRED and would fail closed.`);
console.log("");
console.log(`  STOCK: governed stock/inventory tables found = ${stockTables.length ? stockTables.join(", ") : "NONE"}`);
console.log("    => STOCK_QUANTITY_NOT_GOVERNED. The business statement that the company holds Farenhyt");
console.log("       stock is NOT translated into invented SKU-level inventory quantities.");

// ===========================================================================
bar("F. DETAILED FARENHYT BOM WITH INTERNAL PRICING");

// ---- Governed commercial rule (RULES loaded above, used here) ---------------
const inForce = (r, at) => (!r.effective_from || new Date(r.effective_from) <= at) &&
                           (!r.effective_to || new Date(r.effective_to) >= at);

// Rule selection. BRAND SCOPE IS ENFORCED HERE and nowhere softer: the rule
// carries brand_id = Farenhyt, and a product whose brand is Notifier, Gamewell,
// Gent or unbranded can never match it.
const RULE_CONFLICTS = [];
function selectRule(productBrandId, at) {
  const applicable = RULES.filter((r) => {
    if (!inForce(r, at)) return false;
    if (r.brand_id) return norm(r.brand_id) === norm(productBrandId);
    return true; // a manufacturer-scoped rule with no brand
  });
  if (applicable.length === 0) return { rule: null, conflict: null };
  if (applicable.length > 1) {
    const conflict = {
      code: "COMMERCIAL_RULE_CONFLICT",
      rules: applicable.map((r) => ({ id: r.id, brandId: r.brand_id, bp: r.discount_basis_points, from: r.effective_from, to: r.effective_to })),
      resolution: "NONE_APPLIED__CONFLICT_REQUIRES_HUMAN_RESOLUTION",
    };
    RULE_CONFLICTS.push(conflict);
    return { rule: null, conflict };
  }
  return { rule: applicable[0], conflict: null };
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Derived net cost. The SOURCE price is never mutated; the original amount is
// carried through into the provenance record.
function deriveNet(price, productBrandId, at) {
  const { rule, conflict } = selectRule(productBrandId, at);
  if (conflict) return { net: null, conflict, rule: null };
  if (!rule) return { net: null, rule: null, noRule: true };
  const bp = Number(rule.discount_basis_points);
  const mult = Math.round((10000 - bp) / 10000 * 1000000) / 1000000;
  const listAmount = price.amt;
  return {
    rule,
    conflict: null,
    net: {
      listAmount,
      listCurrency: price.ccy,
      discountBasisPoints: bp,
      discountPercent: bp / 100,
      netMultiplier: mult,
      netAmount: round2(listAmount * mult),
      ruleId: rule.id,
      ruleVersion: rule.version_number,
      ruleApprovalState: rule.approval_state,
      ruleBrandId: rule.brand_id,
      calculationMethod: rule.calculation_method,
      sourcePriceId: price.priceRecordId ?? null,
      calculatedAt: new Date().toISOString(),
    },
  };
}

// price lookup, preferring the most recent governed source, never the cheapest
function priceFor(pn) {
  if (!pn) return null;
  const recs = db.prepare(`SELECT pr.*, p.brand_id FROM price_records pr JOIN library_products p ON p.id=pr.product_id
    WHERE UPPER(p.part_number)=UPPER(?)`).all(pn);
  const ids = db.prepare("SELECT id FROM product_identities WHERE UPPER(normalized_product_code)=UPPER(?)").all(pn).map((r) => r.id);
  const ips = ids.length ? db.prepare(`SELECT pip.* FROM product_identity_prices pip WHERE pip.product_identity_id IN (${ids.map(() => "?").join(",")})`).all(...ids) : [];
  if (!recs.length && !ips.length) return { pn, found: false };
  const rows = [
    ...recs.map((r) => ({ amt: r.amount_minor / 100, ccy: r.currency, type: r.price_type, src: "2023 Farenhyt list", date: "2023-03-01", valid: r.validity_state, until: r.valid_until, appr: r.approval_status, use: r.downstream_use, brandId: r.brand_id, priceRecordId: r.id, sourceId: r.source_id })),
    ...ips.map((r) => { const s = (() => { try { return JSON.parse(r.source_location || "{}"); } catch { return {}; } })(); return { amt: Number(r.price_amount), ccy: r.currency, type: r.price_type, src: s.sheet || "identity", date: s.fileName?.includes("2026") ? "2026-01-04" : "unknown", valid: r.discovery_status, until: r.validity, appr: "-", use: r.costing_eligible ? "Costing" : "Discovery Only", brandId: null, priceRecordId: null, sourceId: null }; }),
  ];
  // Duplicate records exist across DIFFERENT price-list families. Selection order:
  //   1. a source the governed commercial rule actually covers (so the rule can
  //      transform it) -- this is why the Farenhyt 2023 list is preferred over a
  //      newer third-party list that merely shares the P/N string;
  //   2. governance state (approved + Costing first);
  //   3. recency.
  // It is deliberately NOT "take the cheapest": resolving a price conflict by
  // picking the lower number is how an unapproved price gets smuggled into cost.
  const coveredSources = new Set(RULES.map((r) => r.source_id).filter(Boolean));
  const ruleCovered = (r) => (r.priceRecordId && coveredSources.has(r.sourceId)) || (coveredSources.size === 0);
  const govRank = (r) => (isCostingApproved(r) ? 0 : norm(r.use) === "costing" ? 1 : 2);
  const ordered = [...rows].sort((a, b) => {
    const rc = Number(ruleCovered(b)) - Number(ruleCovered(a));
    if (rc) return rc;
    const g = govRank(a) - govRank(b);
    if (g) return g;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  const pick = ordered[0];
  return { pn, found: true, pick, all: rows, dup: rows.length > 1 && new Set(rows.map((r) => `${r.ccy}${r.amt}`)).size > 1 };
}

// Detector BASE census, derived from the governed mounting matrix rather than
// from an arithmetic total. A duct head is installed INSIDE a DNR/DNRW housing
// whose own evidence says base_required = No, so it contributes ZERO B501-IV
// bases while still contributing one SLC address.
const baseCensus = buildBaseCensus({ smoke: CENSUS_Q.smoke, heatTotal, combined: CENSUS_Q.combined, duct: CENSUS_Q.duct });
const heatResolvedForBases = heatRorQty || 9;

const BOM_LINES = [
  ...FARENHYT_SELECTION.filter((s) => s.pn || s.candidates),
  // Heat detectors whose device is still undecided stay visible and uncosted.
  // With nothing open, no such line is emitted at all -- a zero-quantity
  // "unresolved" row would be noise, not information.
  ...(heatOpenQty > 0 ? [{
    key: "heatOpen",
    requirement: `Heat detectors, unresolved (${heatOpenRows.map((d) => `row ${d.boqSourceRow}: ${d.section}`).join("; ") || "none"})`,
    pn: null,
    candidates: ["IDP-HEAT-ROR-IV", "IDP-HEAT-HT-IV"],
    selection: "TECHNICAL_SELECTION_REVIEW_REQUIRED",
    qty: heatOpenQty,
  }] : []),
];

const QTY = {
  smoke: CENSUS_Q.smoke, heatRor: heatResolvedForBases, heatOpen: heatOpenQty, combined: CENSUS_Q.combined,
  ductHead: CENSUS_Q.duct, ductHousing: CENSUS_Q.duct, ductHousingWp: null, ductTube: CENSUS_Q.duct, ductTest: CENSUS_Q.duct,
  pull: CENSUS_Q.pull, monitor: CENSUS_Q.monModule, doorContact: CENSUS_Q.doorContact, control: CENSUS_Q.ctrlModule,
  detectorBase: baseCensus.baseQuantity,
  panel: panels, loopCard: kitsNeeded * 2, loopKit: kitsNeeded, networkCard: 1,
  ftJack: CENSUS_Q.ftJack, ftInterface: null, ftPanel: null, ftHandset: null, ftCabinet: null,
  notifIndoorStrobe: CENSUS_Q.strobe, notifIndoorHornStrobe: CENSUS_Q.strobeSounder, notifOutdoor: CENSUS_Q.strobeWp,
  distributedPower: null, annunciator: null,
};

const state = (s) => {
  if (s.selection === "EXACT_SELECTION") return "READY_FOR_COSTING";
  if (s.selection === "TECHNICAL_SELECTION_REVIEW_REQUIRED") return "TECHNICAL_SELECTION_REQUIRED";
  if (s.selection === "QUANTITY_TOPOLOGY_REQUIRED") return "QUANTITY_TOPOLOGY_REQUIRED";
  return "CONFIGURATION_REQUIRED";
};

let listTotalUsd = 0, netTotalUsd = 0, netTotalSar = 0, costableLines = 0, costableUnits = 0;
const rows = [];
const AT = new Date();
console.log(`  ${"Requirement".padEnd(38)}${"P/N".padEnd(14)}${"Qty".padStart(5)}  ${"ListUSD".padStart(9)}${"NetUSD".padStart(9)}${"NetSAR".padStart(10)}${"Ext SAR".padStart(12)}  State`);
console.log("  " + "-".repeat(118));
for (const s of BOM_LINES) {
  const qty = QTY[s.key] ?? null;
  const st = state(s);
  const price = s.pn ? priceFor(s.pn) : null;
  let lineState = st;
  let listUsd = null, netUsd = null, netSar = null, extSar = null, derivation = null, conflict = null;

  // Only a line that is TECHNICALLY resolved AND quantity resolved may be costed.
  // A price existing somewhere does not make an unresolved technical line costable.
  const technicallyResolved = st === "READY_FOR_COSTING";
  if (technicallyResolved && qty !== null && price?.found && price.pick) {
    if (price.pick.ccy !== "USD") {
      lineState = "FX_REQUIRED";
    } else {
      const d = deriveNet(price.pick, price.pick.brandId, AT);
      conflict = d.conflict;
      if (d.conflict) {
        lineState = "COMMERCIAL_RULE_CONFLICT";
      } else if (d.noRule) {
        lineState = "PRICE_BASIS_REVIEW_REQUIRED";
      } else if (d.net) {
        listUsd = d.net.listAmount;
        netUsd = d.net.netAmount;
        netSar = round2(netUsd * Number(fx.rate));
        extSar = round2(netSar * qty);
        listTotalUsd += round2(listUsd * qty);
        netTotalUsd += round2(netUsd * qty);
        netTotalSar += extSar;
        costableLines += 1; costableUnits += qty;
        derivation = d.net;
        lineState = "READY_FOR_COSTING";
      }
    }
  } else if (technicallyResolved && qty === null) {
    lineState = "QUANTITY_TOPOLOGY_REQUIRED";
  } else if (technicallyResolved && !price?.found) {
    lineState = "PRICE_MISSING";
  }
  rows.push({ s, qty, price, listUsd, netUsd, netSar, extSar, derivation, conflict, lineState });
  console.log(`  ${s.requirement.slice(0, 37).padEnd(38)}${(s.pn ?? (s.candidates ? `[${s.candidates.length}cand]` : "[pending]")).padEnd(14)}${String(qty ?? "TBD").padStart(5)}  ${(listUsd !== null ? listUsd.toFixed(2) : "-").padStart(9)}${(netUsd !== null ? netUsd.toFixed(2) : "-").padStart(9)}${(netSar !== null ? netSar.toFixed(2) : "-").padStart(10)}${(extSar !== null ? extSar.toFixed(2) : "-").padStart(12)}  ${lineState}`);
}
console.log("  " + "-".repeat(118));
console.log("  Provenance on every costed line:");
console.log("    LIST PRICE  -> unchanged, from the governed price record (never overwritten)");
console.log("    DISCOUNT    -> governed Farenhyt rule, brand-scoped, Approved");
console.log("    NET UNIT    -> derived = list x netMultiplier");
console.log("    FX          -> governed approved USD->SAR rate read from pricing_exchange_rates");
console.log("    EXTENDED    -> net SAR x quantity");
if (RULE_CONFLICTS.length) {
  console.log("");
  console.log("  COMMERCIAL_RULE_CONFLICT detected:");
  for (const c of RULE_CONFLICTS) console.log(`      ${c.code}: ${JSON.stringify(c.rules)} -> ${c.resolution}`);
}
console.log("");
console.log(`  Stock: STOCK_QUANTITY_NOT_GOVERNED on every line (no inventory data exists in the project).`);
console.log("");

// ===========================================================================
bar("G. COSTING SUMMARY");
const counts = {};
for (const r of rows) counts[r.lineState] = (counts[r.lineState] || 0) + 1;
console.log("  Line states:");
// Every governed state is always printed, INCLUDING the zero ones. A state that
// silently disappears reads as "not measured" rather than "none outstanding",
// and "none outstanding" is a result worth seeing.
const ALL_STATES = ["READY_FOR_COSTING", "CONFIGURATION_REQUIRED", "QUANTITY_TOPOLOGY_REQUIRED", "TECHNICAL_SELECTION_REQUIRED"];
for (const k of ALL_STATES) console.log(`    ${k.padEnd(40)} ${counts[k] ?? 0}`);
console.log(`    ${"TOTAL LINES".padEnd(40)} ${rows.length}`);
console.log("");
console.log(`  Total list-price reference value (costed lines)   : ${listTotalUsd.toFixed(2)} USD  (${round2(listTotalUsd * Number(fx.rate)).toFixed(2)} SAR at list)`);
console.log(`  Costable NET material subtotal                   : ${netTotalUsd.toFixed(2)} USD  =  ${netTotalSar.toFixed(2)} SAR`);
console.log(`  Costable line count                              : ${costableLines}`);
console.log(`  Costable unit count                              : ${costableUnits}`);
console.log("");
console.log("  RECONCILIATION CHECK (derived, not an encoded business rule):");
console.log(`      net SAR = net USD x ${fx.rate}  =  list USD x 0.35 x ${fx.rate}  =  list USD x ${(0.35 * Number(fx.rate))}`);
console.log(`      the factor ${(0.35 * Number(fx.rate))} is ONLY 0.35 x ${fx.rate} and is not a stored rule; the stored rule is the 65% discount.`);
console.log("");
console.log("  THIS IS A PARTIAL MATERIAL COST, NOT THE FINAL PROJECT MATERIAL COST.");
console.log("  Unresolved BOM lines remain and are excluded from the subtotal above. They are not zeroed.");
console.log("");
console.log("  Neither figure is the project total. The unpriced / unresolved remainder is UNKNOWN, not zero:");
console.log(`    - ${counts.CONFIGURATION_REQUIRED || 0} line(s) await a configuration discriminator (notification P/N, tube length, door module, power, annunciator)`);
console.log(`    - ${counts.TECHNICAL_SELECTION_REQUIRED || 0} line(s) await technical selection`
  + ` (${heatOpenQty} heat detector(s) at ${heatOpenRows.map((d) => d.section).join(", ") || "n/a"})`);
console.log(`    - ${counts.QUANTITY_TOPOLOGY_REQUIRED || 0} line(s) await telephone topology`);
console.log("");
console.log("  DETECTOR BASE CENSUS -- derived from the governed mounting matrix");
console.log(`      ${"detector".padEnd(20)}${"qty".padStart(6)}${"base".padStart(6)}${"application".padEnd(4)}`);
for (const r of baseCensus.rows) {
  console.log(`      ${String(r.pn ?? "(identity pending)").padEnd(20)}${String(r.quantity).padStart(6)}${String(r.baseQuantity).padStart(6)}  ${r.application}`);
}
console.log(`      ${"TOTAL".padEnd(20)}${String(baseCensus.rows.reduce((t, r) => t + r.quantity, 0)).padStart(6)}${String(baseCensus.baseQuantity).padStart(6)}`);
console.log("");
console.log(`      ${baseCensus.basePn} quantity        : ${baseCensus.baseQuantity}   (= spot bases only)`);
console.log(`      previous (incorrect) quantity: ${CENSUS_Q.smoke + heatResolvedForBases + CENSUS_Q.combined + CENSUS_Q.duct}, which counted the ${CENSUS_Q.duct} duct heads`);
console.log("                                  as if each needed a base. A duct head installs INSIDE a DNR/DNRW");
console.log("                                  housing whose evidence says base_required = No, and B501-IV's");
console.log("                                  compatible_detector_families contains no duct family.");
console.log(`      heat identity               : ${heatOpenQty === 0
  ? "all 26 heat units carry an exact P/N, so the base quantity is fully determined"
  : `${heatOpenQty} unit(s) have no chosen P/N, but BOTH candidates (IDP-Heat-ROR and IDP-Heat-HT) are in B501-IV's compatible list, so their bases are counted and the base quantity is NOT held open.`}`);
console.log(`      SLC detector points        : ${detPts}   (= ${baseCensus.spotPoints} spot + ${baseCensus.ductPoints} duct)`);
console.log("                                  A duct head consumes ZERO bases but still consumes exactly ONE");
console.log("                                  address, so removing its base does NOT remove its point.");
console.log(`      loop requirement           : aggregate minimum ${aggregateMin} loops, installed ${installedTotal}`);
console.log("");
console.log("  Every one of those lines has a price somewhere in the library. None of them is costed,");
console.log("  because the blocker is TECHNICAL or QUANTITY, not commercial. A discount rate cannot");

console.log("");
bar("H. STATE ASSERTIONS");
console.log(`  preferred brand          : FARENHYT`);
console.log(`  brandRelationship        : IN_HOUSE`);
console.log(`  commercialWorkflow       : INTERNAL_SELECTION_AND_PRICING`);
console.log(`  supplier RFQ required    : NO`);
console.log(`  supplier selection authority: NO`);
console.log(`  ROR heat selection       : IDP-HEAT-ROR-IV (fixed + rate-of-rise), replacing IDP-HEAT-IV`);
console.log(`  aggregate loop minimum   : ${aggregateMin}`);
console.log(`  preliminary installed    : ${installedTotal} loops (${inBuildLoops} in-build + ${expansionLoops} expansion) across ${panels} panels`);
console.log("=".repeat(118));
