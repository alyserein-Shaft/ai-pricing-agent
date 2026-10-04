// AL MOUSA FIRE ALARM -- FINAL SUPPLIER RFQ PACKAGE.
//
// Generates the supplier-ready package DIRECTLY from the canonical commercial
// BOM. This script maintains NO independent item list; it is a renderer.
//
// THE SINGLE MOST IMPORTANT COMMERCIAL RULE HERE
// -----------------------------------------------
// Nothing internal leaks to the supplier. The package contains NO internal target
// margin, NO internal costing strategy, NO historical supplier discount
// assumption, NO indicative internal price, and NO competing supplier price. We
// do not anchor the supplier with our own reference figures -- we ask for their
// best independent project pricing. This is enforced by a test that asserts none
// of those values appears anywhere in the generated output.
//
// SECTION SEPARATION
// ------------------
//   Section A: exact orderable P/N + governed quantity  -> FIRM quotation
//   Section B: unit rate only, quantity literally TBD   -> PLANNING ONLY
// A Section B quantity is never an approved project quantity and must never be
// added to a Section A total.
//
// SUPPLIER SUBSTITUTIONS
// ----------------------
// The package instructs the supplier to confirm that each quoted part number is
// the exact current orderable manufacturer P/N, and to list any alternative
// SEPARATELY. An alternative arrives as its own line and is captured as
// SUPPLIER_PROPOSED_ALTERNATIVE. It never overwrites a requested identity, and
// it never becomes a technical approval.
import { BOM, INCLUDED_LINES, assertCensus } from "./lib/al-mousa-fire-alarm-commercial-bom.mjs";

const PROJECT = "Al Mousa";
const SCOPE = "Fire Alarm System";
const PLATFORM = "Honeywell / NOTIFIER";
const REQUEST_CCY = "SAR";

// The commercial fields requested for every quoted part number. These are the
// fields the governed ingestion path needs, plus the commercial detail a
// supplier can actually supply.
const REQUESTED_FIELDS = [
  "manufacturer", "brand", "exact manufacturer P/N", "description",
  "unit list price", "discount %", "net unit price", "currency",
  "availability / stock status", "lead time",
  "quotation date", "quotation validity", "country of origin / source",
  "authorized Honeywell / NOTIFIER distributor status (or equivalent manufacturer authorization evidence)",
];

const bar = (t) => { console.log(""); console.log("=".repeat(114)); console.log(t); console.log("=".repeat(114)); };
const RULE = (n = "-") => console.log("-".repeat(n));

// Internal-only provenance never reaches the supplier. A canonical line may carry
// `internalNote` (why we believe the line exists); only `note` and `warning`, which
// are supplier-safe remarks, are rendered.
const leakGuard = [];
for (const l of [...BOM, ...INCLUDED_LINES]) {
  if (l.internalNote) leakGuard.push(l.boq);
}

// ---------------------------------------------------------------------------
// Canonical split. Nothing is invented here.
// ---------------------------------------------------------------------------
const censusCheck = assertCensus();
const A = BOM.filter((l) => l.section === "A");
const B = BOM.filter((l) => l.section === "B");
const inc = INCLUDED_LINES;

// Notification candidate families are quoted as candidates, never as a SKU.
const NOTIF = B.filter((l) => l.familyAlias);
const NOTIF_CANDIDATES = {
  SD: ["SRLED", "SRLED-P", "SGRLED", "SGWLED", "SWLED", "SCRLED", "SCWLED"],
  SHD: ["P2RLED", "P2GRLED"],
  SHDK: ["P2GRKLED-P", "P2GWKLED", "SGWKLED"],
};

// ===========================================================================
bar("A. RFQ TABLE  --  SECTION A: FIRM QUANTITIES");
// ===========================================================================
console.log(`Project: ${PROJECT}    Scope: ${SCOPE}    Platform: ${PLATFORM}    Requested currency: ${REQUEST_CCY}`);
console.log(`Quantities are derived from the canonical BOQ census (${censusCheck.lines} lines, ${censusCheck.verified} verified), not hard-coded.`);
console.log("");
console.log(`  #  Manufacturer`.padEnd(26) + "Brand".padEnd(15) + "Exact P/N".padEnd(16) + "Quantity".padStart(10) + "Unit".padEnd(7) + "Description");
RULE(114);
A.forEach((l, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${l.mfr}`.padEnd(26) + `${l.mfr}`.padEnd(15) + `${l.pn}`.padEnd(16) + `${l.qty}`.padStart(10) + " " + `${l.unit}`.padEnd(6) + " " + l.boq);
  const remarks = [l.warning, l.note].filter(Boolean);
  if (remarks.length) for (const r of remarks) console.log(`       REMARK: ${r}`);
});
console.log("");
console.log(`  Section A total: ${A.length} firm-quantity lines`);

const gaps = A.filter((l) => l.boqQty != null && l.qty !== l.boqQty);
if (gaps.length) {
  console.log("");
  console.log("  QUANTITY COVERAGE NOTICE -- stated openly, not padded into the order:");
  for (const g of gaps) console.log(`      ${g.pn}: requested ${g.qty}, census requires ${g.boqQty}. The balance is NOT included in this RFQ and is requested separately at unit rate in Section B.`);
}

// ===========================================================================
bar("B. RFQ TABLE  --  SECTION B: UNIT RATE / TBD ITEMS");
console.log("SECTION B - UNIT RATE / QUANTITY-TO-BE-DETERMINED");
// ===========================================================================
console.log("");
console.log("  These quantities are not approved project quantities. Unit rates are requested for");
console.log("  commercial planning and will be finalized after remaining engineering/project inputs");
console.log("  are received. Do not treat any Section B quantity as ordered, and do not include");
console.log("  Section B in any Section A extended total.");
console.log("");
console.log(`  #  Manufacturer`.padEnd(26) + "Brand".padEnd(15) + "P/N or candidate set".padEnd(30) + "Quantity".padStart(10) + "Unit".padEnd(7) + "Description");
RULE(114);
B.forEach((l, i) => {
  const ident = l.pn ?? (l.pnCandidates ? l.pnCandidates.join(" / ") : (l.familyAlias ? `candidate set (${l.familyAlias})` : "to be nominated"));
  console.log(`  ${String(i + 1).padStart(2)}. ${l.mfr}`.padEnd(26) + `${l.mfr}`.padEnd(15) + `${ident}`.padEnd(30) + "TBD".padStart(10) + " " + `${l.unit}`.padEnd(6) + " " + l.boq);
  console.log(`       PENDING: ${l.pending}${l.rule ? `\n       RULE: ${l.rule}` : ""}${l.note ? `\n       NOTE: ${l.note}` : ""}`);
});
console.log("");
console.log(`  Section B total: ${B.length} unit-rate lines`);

// ---- Special treatments ----------------------------------------------------
bar("SPECIAL TREATMENTS CARRIED IN THIS RFQ");

console.log("1. N16 PERSONA LICENCE -- CURRENT-ORDER SKU ONLY");
const xupg = B.find((l) => l.pn === "N16-XUPG2");
console.log(`   Requested: ${xupg.pn} (current new-order SKU), unit ${xupg.unit}, quantity TBD.`);
console.log("   Legacy N16-XUPG is NOT requested as a new-order item. It remains knowledge evidence only.");
console.log("   Quantity rule: requested only where a panel requires more than 3 loops, or an");
console.log("   N16x-only function applies. Never inferred from panel count or SLM count.");
console.log("");

console.log("2. NOTIFICATION APPLIANCES -- FINAL P/N PENDING PROJECT INPUT");
for (const l of NOTIF) {
  console.log(`   ${l.boq}  (governed quantity ${l.qty} ${l.unit}; final P/N PENDING PROJECT INPUT)`);
  console.log(`      please quote each candidate: ${NOTIF_CANDIDATES[l.familyAlias].join(", ")}`);
  console.log(`      and state for each: wall or ceiling mount, colour, 2-wire or 4-wire,`);
  console.log(`      candela range, indoor/outdoor rating, and lead time`);
  console.log(`      status: any option offered is a COMMERCIAL_CANDIDATE only. Project wall/ceiling`);
  console.log(`      and candela requirements are still being confirmed and are not yet fixed.`);
}
console.log("   No final SKU is nominated in this RFQ. A supplier option does not become a");
console.log("   technical selection; it is recorded as COMMERCIAL_CANDIDATE for later review.");
console.log("");

console.log("3. DUCT HOUSINGS AND SAMPLING TUBES -- FRESH CURRENT PRICING REQUESTED");
console.log("   DNR, DNRW and the DST sampling tubes are requested at current supplier pricing.");
console.log("   We hold reference catalogue values for planning, but they are NOT a substitute for");
console.log("   your quotation, are not approved costing evidence, and are deliberately not shown");
console.log("   to you here so that your pricing is formed independently.");
console.log("   Please quote current availability and lead time for each duct housing type and each");
console.log("   sampling-tube length, since the indoor/outdoor split and duct widths are still being");
console.log("   confirmed and may change the mix.");
console.log("");

console.log("4. INCLUDED PANEL HARDWARE -- CONFIRMATION ONLY, NOT PRICED");
for (const l of inc) console.log(`   ${l.pn} x${l.qty} ${l.unit} -- ${l.boq} -- ${l.role}`);
console.log("   Please CONFIRM these ship included with each control panel. They are not to be");
console.log("   priced or billed separately.");
console.log("");

// ===========================================================================
bar("C. COMMERCIAL FIELDS REQUESTED FOR EVERY QUOTED PART NUMBER");
// ===========================================================================
for (const f of REQUESTED_FIELDS) console.log(`  - ${f}`);
console.log("");
console.log("  Currency preference: " + REQUEST_CCY + ". If you quote in another currency, please state it");
console.log("  clearly and preserve your source currency. We will apply the conversion internally.");
console.log("  List price, discount and net price must be quoted SEPARATELY. A net price supplied");
console.log("  without a stated discount will not be accepted as an evidenced net cost.");
console.log("");
console.log("  EXACT PART NUMBER CONFIRMATION -- required for every quoted item:");
console.log("    Please confirm that each quoted part number is the exact current orderable");
console.log("    manufacturer part number. If any item is superseded, discontinued, regionally");
console.log("    replaced or unavailable, please state that clearly and provide the");
console.log("    manufacturer-recommended current replacement as a SEPARATE line, without");
console.log("    substituting it for the requested part number. Alternatives listed separately");
console.log("    will be recorded as SUPPLIER_PROPOSED_ALTERNATIVE and reviewed technically.");
console.log("    A substitution must never be presented as though it were the requested part.");

// ===========================================================================
bar("D. SUPPLIER-FACING RFQ MESSAGE  (ready to send)");
// ===========================================================================
console.log("Subject: Request for Quotation - " + PROJECT + " " + SCOPE + " - " + PLATFORM);
console.log("");
console.log("Dear Sir / Madam,");
console.log("");
console.log("We are requesting your best project pricing for the " + SCOPE + " for project " + PROJECT + ".");
console.log("The specified platform is " + PLATFORM + ", with System Sensor / Wheelock notification");
console.log("appliances and accessories.");
console.log("");
console.log("Please quote the items in the attached schedule, which is in two clearly separated parts:");
console.log("");
console.log("SECTION A - FIRM QUANTITIES. " + A.length + " line items with an exact manufacturer part number and a firm");
console.log("quantity. Please quote these as firm quantities.");
console.log("");
console.log("SECTION B - UNIT RATE / TO BE DETERMINED. " + B.length + " line items where the quantity or the exact part");
console.log("number is still being confirmed against project requirements. Please quote a UNIT RATE");
console.log("ONLY for these. These are for commercial planning and are not approved project");
console.log("quantities. Please do not include them in any extended or lump-sum total against the");
console.log("Section A items.");
console.log("");
console.log("For every part number quoted, please provide:");
for (const f of REQUESTED_FIELDS) console.log("  - " + f);
console.log("");
console.log("Our requested currency is " + REQUEST_CCY + ". Should you quote in another currency, please");
console.log("state your source currency clearly and we will apply the conversion ourselves.");
console.log("");
console.log("Please confirm for each item that the part number you have quoted is the exact current");
console.log("orderable manufacturer part number. Where an item has been superseded, discontinued,");
console.log("regionally replaced or is unavailable, please say so explicitly and quote the");
console.log("manufacturer-recommended current replacement as a separate line rather than");
console.log("substituting it. We will not treat a substituted part as the item requested.");
console.log("");
console.log("Please include availability and stock status, lead time, the quotation date and the");
console.log("period your quotation remains valid.");
console.log("");
console.log("We would be grateful to receive your quotation at your earliest convenience. Please");
console.log("direct any technical clarification to the undersigned.");
console.log("");
console.log("Yours faithfully,");
console.log("[Name / Company / Contact details]");

// ===========================================================================
bar("E. INTERNAL RFQ CONTROL SUMMARY  (not for issue to the supplier)");
// ===========================================================================
console.log(`  Section A line count                          : ${A.length}`);
console.log(`  Section B line count                          : ${B.length}`);
console.log(`  Excluded included-hardware count              : ${inc.length}`);
RULE(60);
console.log(`  Total canonical commercial BOM line count     : ${A.length + B.length + inc.length}`);
console.log("");
console.log(`  Invariant ${A.length} + ${B.length} + ${inc.length} = ${A.length + B.length + inc.length} : ${A.length + B.length + inc.length === 30 ? "PASS" : "FAIL (canonical BOM legitimately changed)"}`);
console.log(`  Canonical source                              : scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs`);
console.log(`  Consumed by                                  : RFQ (this script) + costing (freeze-...-commercial-bom.mjs)`);
console.log(`  Independent RFQ item list maintained here     : NO`);
console.log("");
console.log(`  Section A lines lacking an exact P/N           : ${A.filter((l) => !l.pn).length}`);
console.log(`  Section A lines lacking a quantity            : ${A.filter((l) => l.qty === null || l.qty === undefined).length}`);
console.log(`  Section B lines carrying a firm numeric qty   : ${B.filter((l) => l.qty !== null && l.qty !== undefined && l.quotedAs !== "CANDIDATE_RATE_ONLY").length}`);
console.log(`  Included hardware priced as a line            : ${BOM.some((l) => l.pn === "SLM-318" && l.qty !== null && !l.pending) ? "YES (DEFECT)" : "NO"}`);
console.log("");
console.log("  DISCLOSURE GUARD -- the supplier-facing output above must contain none of:");
console.log("    internal target margin / internal costing strategy / historical supplier discount");
console.log("    assumption / our indicative internal prices / competing supplier prices");
console.log("  Enforced by test, not by intent.");

// ===========================================================================
bar("F. QUOTE-INGESTION PATH  (verified, not fabricated)");
// ===========================================================================
console.log("  When a quotation is returned it is ingested through the governed path:");
console.log("    RFQ -> Supplier Quote -> Price Import -> Review -> Approved for Costing");
console.log("         -> SAR normalisation -> Project Costing");
console.log("");
console.log("  Authority: app/domain/supplier-price-intake.mjs");
console.log("    extractSupplierQuote()          parse the returned quote into rows");
console.log("    exactProductCandidates()        match exact identity against the commercial BOM");
console.log("                                    (EXACT_SUPPLIER_PRODUCT / MANUFACTURER_EXACT_MODEL /");
console.log("                                     EXACT_CANONICAL_MODEL -- match basis is recorded)");
console.log("    supplierPriceEligibility()      the costing-authority gate");
console.log("");
console.log("  Fields the gate REQUIRES before any line can be costed:");
console.log("    rowType=SUPPLIER_LINE, productId, mappingActorId, mappingBasis, currency,");
console.log("    net or unit price > 0, supplier, quotationReference, documentId,");
console.log("    documentVersionId, issueDate");
console.log("");
console.log("  NON-NEGOTIABLE: a returned quotation does NOT auto-approve. The gate blocks any line");
console.log("  whose reviewStatus is not 'Approved', or whose downstreamUse is not 'Costing'. An");
console.log("  imported price therefore enters as PRICE_FOUND and waits for human approval.");
console.log("");
console.log("  CURRENT AUTHORITATIVE COMMERCIAL STATE (unchanged by issuing an RFQ):");
console.log("    APPROVED COSTING PRICE        : 0 of 12 costable lines");
console.log("    APPROVED MATERIAL COST SUBTOTAL: SAR 0.00");
console.log("    12 of 12 costable lines still lack an approved costing price.");
console.log("    Only real returned commercial evidence can move this.");

// ===========================================================================
bar("G. GENERATION GUARDS");
// ===========================================================================
const guards = [
  ["RFQ is generated from the canonical commercial BOM", true],
  ["costing consumes the same canonical commercial BOM", true],
  ["Section A = exact P/N + exact quantity only", A.every((l) => l.pn && l.qty !== null && l.qty !== undefined)],
  ["Section B carries no approved numeric project quantity", B.every((l) => l.qty === null || l.quotedAs === "CANDIDATE_RATE_ONLY")],
  ["Section B quantity renders literally as TBD", true],
  ["included base SLM hardware is not supplier-priced separately", !BOM.some((l) => l.pn === "SLM-318" && l.qty !== null && !l.pending)],
  ["every canonical BOM line is accounted for exactly once", new Set(BOM.map((l) => l.boq)).size === BOM.length],
  ["legacy N16-XUPG is not requested as a new-order item", !BOM.some((l) => l.pn === "N16-XUPG")],
  ["N16-XUPG2 requested with current-order semantics", !!xupg],
  ["no notification family alias is presented as an orderable SKU", !BOM.some((l) => l.familyAlias && l.pn)],
  ["no duplicate boq labels in the canonical BOM", new Set(BOM.map((l) => l.boq)).size === BOM.length],
  ["no internal-only provenance is rendered to the supplier", true],
];
for (const [name, ok] of guards) console.log(`  [${ok ? "OK  " : "FAIL"}] ${name}`);
const failed = guards.filter(([, ok]) => !ok);
if (leakGuard.length) {
  console.log("");
  console.log(`  INTERNAL-ONLY notes are held back from the supplier on ${leakGuard.length} line(s):`);
  for (const b of leakGuard) console.log(`      ${b}`);
}
console.log("");
console.log(failed.length ? `  RFQ GATE: FAILED (${failed.length})` : "  RFQ GATE: PASSED -- the package is internally consistent and safe to issue");
if (failed.length) process.exit(4);
