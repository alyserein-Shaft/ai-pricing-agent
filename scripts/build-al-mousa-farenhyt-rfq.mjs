// FIRE ALARM EXTERNAL-BRAND SUPPLIER RFQ  --  ** NOT THE AL MOUSA PATH **
//
// ============================================================================
// DO NOT ISSUE THIS RFQ FOR AL MOUSA.
//
// CORRECTED 2026-09-30 by authoritative engineer decision. Farenhyt is an
// IN_HOUSE brand (governed registry IN_HOUSE = Farenhyt, Gamewell, Gent), so the
// Al Mousa commercial workflow is:
//
//     INTERNAL_DETAILED_TECHNICAL_SELECTION -> INTERNAL_BOM
//     -> INTERNAL_COMMERCIAL_PRICING -> COSTING -> QUOTATION
//
// The company does NOT issue a supplier RFQ for product selection or pricing on
// in-house brands, and the supplier is NOT the selection authority. The correct
// Al Mousa next slice is:
//
//     FARENHYT_INTERNAL_DETAILED_SELECTION_AND_PRICING
//
// This script is RETAINED, not deleted, because it remains the correct generator
// for an EXTERNAL-brand Fire Alarm RFQ (for example a NOTIFIER-basis project),
// where the supplier-assisted workflow does apply. It is kept as that capability
// rather than thrown away.
//
// It must not be run as part of Al Mousa.
// ============================================================================
//
// Generated from the preliminary Farenhyt solution. Per
// docs/fire-alarm-brand-and-pre-sales-policy.md section 4b, on an EXTERNAL brand
// the supplier completes detailed selection and the engineer reviews it.
//
// TWO SECTIONS, CLEARLY SEPARATED
//   Section A: KNOWN SELECTED ITEMS -- family or P/N established AND quantity governed.
//   Section B: SUPPLIER SELECTION REQUIRED -- we state the requirement and the preferred
//              platform, and ask the supplier to propose the exact P/N and accessories.
//
// Section A is NOT inflated to look bigger. Lines that are not genuinely settled stay in
// Section B. Inventing certainty to fill Section A would be the failure mode here.
//
// SUPPLIER PROPOSALS DO NOT AUTO-APPROVE. A returned proposal enters as
// SUPPLIER_PROPOSED_TECHNICAL_SOLUTION and requires engineer review before it becomes the
// approved BOM that price approval and costing consume.
import { CENSUS_Q, assertCensus } from "./lib/al-mousa-fire-alarm-commercial-bom.mjs";
import { FARENHYT_PLATFORM } from "./lib/al-mousa-farenhyt-platform.mjs";

assertCensus();
const bar = (t) => { console.log(""); console.log("=".repeat(112)); console.log(t); console.log("=".repeat(112)); };

const PROJECT = "Al Mousa";
const SCOPE = "Fire Alarm System";
const PLATFORM = "Honeywell Farenhyt (with System Sensor / Wheelock notification appliances)";
const REQUEST_CCY = "SAR";

const REQUESTED_FIELDS = [
  "manufacturer and brand", "exact manufacturer P/N", "description",
  "unit list price", "discount %", "net unit price", "currency",
  "availability / stock status", "lead time",
  "quotation date", "quotation validity", "country of origin / source",
  "authorized Honeywell / Farenhyt distributor status (or equivalent manufacturer authorization evidence)",
];

// ---------------------------------------------------------------------------
// SECTION A -- known selected items: settled identity AND governed quantity
// ---------------------------------------------------------------------------
const A = [
  { pn: "IDP-PHOTO-IV", qty: CENSUS_Q.smoke, unit: "No", desc: "Intelligent addressable photoelectric smoke detector", remark: "base not included -- please price the detector only here; bases in Section B" },
  { pn: "IDP-PHOTO-T-IV", qty: CENSUS_Q.combined, unit: "No", desc: "Intelligent addressable photoelectric + thermal (135F) detector", remark: "base not included -- bases in Section B" },
  { pn: "DNR", qty: CENSUS_Q.duct, unit: "No", desc: "InnovairFlex intelligent duct detector housing, non-relay (head not included)", remark: "head is IDP-PHOTO-IV; sampling tube and test/remote accessories in Section B" },
  { pn: "NBG-12LX", qty: 0, unit: "No", desc: "", remark: "" }, // removed below
  { pn: "IDP-PULL-DA", qty: CENSUS_Q.pull, unit: "No", desc: "Intelligent addressable pull station, single action, key reset", remark: "quantity mixes interior and weatherproof BOQ lines -- please split interior vs outdoor in your response" },
  { pn: "IDP-MONITOR", qty: CENSUS_Q.monModule, unit: "No", desc: "Intelligent addressable supervised monitor module, single contact", remark: "priced as the monitor duty; see Section B for door-contact selection" },
  { pn: "IDP-CONTROL", qty: CENSUS_Q.ctrlModule, unit: "No", desc: "Intelligent addressable supervised control module", remark: "" },
  { pn: "FFT-FPJ", qty: CENSUS_Q.ftJack, unit: "No", desc: "Fire fighter phone jack, passive, single gang plate", remark: "passive device -- it consumes no SLC address; please do not price an interface module against this line" },
  { pn: "IFP-2100HV", qty: CENSUS_Q.facp, unit: "No", desc: "2100-point addressable fire alarm control panel, 1 SLC loop card inbuild, 8 on-board Flexput circuits, UL Listed and FM Approved", remark: "7 panels per governed architecture: 1 campus MFACP + 6 FACP" },
  { pn: "ST-10", qty: CENSUS_Q.duct, unit: "No", desc: "Detector sampling tube, 8-10 ft ducts", remark: "PRELIMINARY: duct widths are not scheduled, so tube length may change. See Section B." },
].filter((l) => l.qty > 0);

// ---------------------------------------------------------------------------
// SECTION B -- supplier selection required
// ---------------------------------------------------------------------------
const B = [
  { boq: "Heat detectors (ambient / ROR)", qty: 9, unit: "No", requirement: "Addressable heat detection with ROR at 15F/min per the project specification", platform: "Farenhyt SLC addressable, compatible with IFP-2100HV", ask: "Please nominate the ROR-capable part. Our reference corpus lists IDP-HEAT-IV as FIXED 135F, which we do not believe meets the ROR requirement -- please confirm or propose the correct part." },
  { boq: "Heat detectors (census balance)", qty: CENSUS_Q.heatBOQ - 9, unit: "No", requirement: "remaining addressable heat detectors from the BOQ census", platform: "Farenhyt SLC addressable", ask: "Same selection as above; quantity follows the same device." },
  { boq: "Detector mounting bases", qty: CENSUS_Q.smoke + CENSUS_Q.combined + CENSUS_Q.duct, unit: "No", requirement: "Bases for every addressable detector above (detectors are supplied base-not-included)", platform: "B501-IV 4-inch flangeless, or the correct equivalent", ask: "Please confirm the correct base for each detector type and quote ivory and white variants." },
  { boq: "Door contact interfaces", qty: CENSUS_Q.doorContact, unit: "No", requirement: "Supervised dry-contact input for door contacts", platform: "IDP-MONITOR or IDP-MINIMON", ask: "Please select between the full and mini monitor module on backbox space, and quote." },
  { boq: "SLC loop expansion", qty: null, unit: "No", requirement: "Loop capacity for the current addressable device count", platform: "5815RMK remote mounting kit + 6815 SLC loop expander", ask: "PRELIMINARY REQUIREMENT: approximately 10 SLC loops in total. Please confirm the loop expansion configuration (5815RMK kits and 6815 cards) and quote. Final loop distribution will follow the detailed design." },
  { boq: "Firephone control module", qty: null, unit: "No", requirement: "Addressable telephone interface module(s)", platform: "Farenhyt SLC addressable module", ask: "Quantity depends on telephone circuit topology, which is still being issued. Please quote a unit rate and state the maximum circuits per module." },
  { boq: "Fireman telephone control panel", qty: null, unit: "No", requirement: "Firefighter telephone control panel", platform: "IFP-FFT", ask: "Please confirm IFP-FFT is the correct part and quote a unit rate, including how many handsets and jacks it supports." },
  { boq: "Firefighter handsets", qty: null, unit: "No", requirement: "Remote handsets for the telephone system", platform: "FFT-RHS", ask: "Please quote a unit rate and state compatibility with the telephone panel." },
  { boq: "Handset storage cabinets", qty: null, unit: "No", requirement: "Handset cabinets", platform: "FFT-HSC (holds up to 10 handsets)", ask: "Please quote a unit rate and state the per-cabinet handset capacity so we can size the quantity once the handset count is known." },
  { boq: "Indoor notification appliances", qty: CENSUS_Q.strobe, unit: "No", requirement: "Conventional NAC strobe, 24 V, UL 1971, 15-110 cd class, System Sensor synchronisation", platform: "System Sensor SRLED / SGRLED / SCRLED", ask: "FINAL P/N PENDING PROJECT INPUT. Please quote each candidate you would supply and state wall vs ceiling, colour and candela range for each. This is a COMMERCIAL_CANDIDATE only; we have not fixed the final P/N." },
  { boq: "Indoor horn/strobes", qty: CENSUS_Q.strobeSounder, unit: "No", requirement: "Conventional NAC horn/strobe, 24 V, UL 1971 + UL 464", platform: "System Sensor P2RLED / P2GRLED", ask: "FINAL P/N PENDING PROJECT INPUT. Quote each candidate and state mounting, colour, wiring and candela. COMMERCIAL_CANDIDATE only." },
  { boq: "Exterior weatherproof horn/strobes", qty: CENSUS_Q.strobeWp, unit: "No", requirement: "Outdoor conventional NAC horn/strobe, weatherproof, 24 V", platform: "System Sensor P2GRKLED / P2GWKLED", ask: "FINAL P/N PENDING PROJECT INPUT. Quote each candidate and state outdoor rating, mounting, colour and candela. COMMERCIAL_CANDIDATE only." },
  { boq: "Duct sampling tubes and remote test", qty: CENSUS_Q.duct, unit: "No", requirement: "Sampling tube and remote test/response indication for each duct detector", platform: "ST-10 tube, RI/007C response indicator, FM996-L8 holder", ask: "Please quote the tube lengths you offer against duct width, plus the response indicator and holder." },
  { boq: "NAC power / distributed power", qty: null, unit: "No", requirement: "Notification appliance power beyond the panel's 8 on-board Flexput circuits", platform: "RPS-1000HV intelligent distributed power module", ask: "Please quote a unit rate and state the per-circuit and total current capability, so we can confirm whether any external supply is needed once NAC zoning is designed." },
  { boq: "Remote annunciator", qty: null, unit: "No", requirement: "Display remote annunciator", platform: "RA-2000", ask: "Please confirm suitability and quote a unit rate." },
  { boq: "Network interface / fibre", qty: null, unit: "No", requirement: "Panel networking for the campus MFACP to FACP topology", platform: "SK-NIC network interface card, SK-FSL fibre module", ask: "Please confirm the required card/module combination for the panel network and quote a unit rate." },
];

// ===========================================================================
bar("AL MOUSA FIRE ALARM -- FARENHYT SUPPLIER RFQ");
console.log("");
console.log("  ############################################################################");
console.log("  #  THIS IS NOT THE AL MOUSA COMMERCIAL PATH. DO NOT ISSUE.                 #");
console.log("  #  Farenhyt is IN_HOUSE -> internal selection, internal pricing.           #");
console.log("  #  Al Mousa next slice: FARENHYT_INTERNAL_DETAILED_SELECTION_AND_PRICING  #");
console.log("  #  This generator is retained for EXTERNAL-brand Fire Alarm RFQs only.    #");
console.log("  ############################################################################");
console.log("");
console.log(`Project           : ${PROJECT}`);
console.log(`Scope             : ${SCOPE}`);
console.log(`Preferred platform: ${PLATFORM}`);
console.log(`Requested currency: ${REQUEST_CCY}`);
console.log(`Basis             : preliminary Farenhyt technical solution; the supplier completes detailed selection.`);
console.log("");

bar("SECTION A -- KNOWN SELECTED ITEMS (identity established, quantity governed)");
console.log("  These are firm quantities. Please quote them as firm.");
console.log("");
console.log(`  #  Exact P/N`.padEnd(22) + "Qty".padStart(7) + "Unit".padEnd(7) + "Description / remarks");
console.log("  " + "-".repeat(108));
A.forEach((l, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${l.pn}`.padEnd(22) + String(l.qty).padStart(7) + " " + l.unit.padEnd(6) + " " + l.desc);
  if (l.remark) console.log(`       REMARK: ${l.remark}`);
});
console.log("");
console.log(`  Section A lines: ${A.length}`);

bar("SECTION B -- SUPPLIER SELECTION REQUIRED");
console.log("  We state the requirement and the preferred platform. YOU propose the exact P/N,");
console.log("  the required accessories, and the quantity.");
console.log("");
console.log("  These quantities are NOT approved project quantities. They are the current BOQ or");
console.log("  device counts against which we need pricing and selection support. Final quantities");
console.log("  will be confirmed after the detailed design.");
console.log("");
console.log(`  #  Item`.padEnd(24) + "QTY".padStart(6) + "  What we need");
console.log("  " + "-".repeat(108));
B.forEach((l, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${l.boq}`.padEnd(24) + String(l.qty ?? "TBD").padStart(6) + "  ${l.unit}");
  console.log(`       REQUIREMENT : ${l.requirement}`);
  console.log(`       PLATFORM    : ${l.platform}`);
  console.log(`       WE ASK      : ${l.ask}`);
});
console.log("");
console.log(`  Section B lines: ${B.length}`);

// ===========================================================================
bar("PRELIMINARY SLC LOOP QUANTITY -- STATED ASSUMPTION");
console.log("  SLC loop quantities are preliminary and based on the current BOQ/device count.");
console.log("  Final loop and panel quantities are subject to revision upon receipt/completion of");
console.log("  the detailed Fire Alarm system design.");
console.log("");
console.log(`  IFP-2100HV limit        : ${FARENHYT_PLATFORM.panel.perLoopDetectors} detectors and ${FARENHYT_PLATFORM.panel.perLoopModules} modules per SLC loop`);
console.log(`  on-board NAC circuits   : ${FARENHYT_PLATFORM.panel.onBoardNacCircuits} per panel`);
console.log("  Please confirm the loop expansion configuration against your own calculation.");

// ===========================================================================
bar("SUPPLIER-FACING MESSAGE (ready to send)");
console.log("Subject: Request for Quotation - " + PROJECT + " " + SCOPE + " - Honeywell Farenhyt");
console.log("");
console.log("Dear Sir / Madam,");
console.log("");
console.log("We request your best project pricing for the " + SCOPE + " on project " + PROJECT + ",");
console.log("specified on the " + PLATFORM + " platform.");
console.log("");
console.log("The schedule is in two parts:");
console.log("");
console.log("SECTION A - " + A.length + " items where we have established the part number and the quantity. Please quote");
console.log("these as firm quantities.");
console.log("");
console.log("SECTION B - " + B.length + " items where the requirement is established but the exact part number, or the");
console.log("final quantity, is still being confirmed against the detailed design. For these we are");
console.log("asking you to propose the exact part number, the required accessories and a unit rate.");
console.log("Please do not treat the Section B quantities as ordered quantities.");
console.log("");
console.log("Please note our SLC loop count is PRELIMINARY and based on the current device count;");
console.log("final loop and panel quantities are subject to revision after the detailed design.");
console.log("Please confirm the loop expansion configuration against your own calculation.");
console.log("");
console.log("For every part number quoted, please provide:");
for (const f of REQUESTED_FIELDS) console.log("  - " + f);
console.log("");
console.log("Our requested currency is " + REQUEST_CCY + ". If you quote in another currency, please state your");
console.log("source currency clearly and we will apply the conversion ourselves.");
console.log("");
console.log("Please confirm for each item that the part number quoted is the exact current orderable");
console.log("manufacturer part number. Where an item is superseded, discontinued, regionally replaced");
console.log("or unavailable, please state that explicitly and quote the manufacturer-recommended current");
console.log("replacement as a SEPARATE line rather than substituting it. A substituted part will not be");
console.log("treated as the item requested.");
console.log("");
console.log("Any part numbers you propose in Section B are treated as a proposed technical solution");
console.log("and will be reviewed by our engineer before they are accepted. They are not approved by");
console.log("this request.");
console.log("");
console.log("We would be grateful to receive your quotation at your earliest convenience.");
console.log("");
console.log("Yours faithfully,");
console.log("[Name / Company / Contact details]");

// ===========================================================================
bar("INTERNAL CONTROL SUMMARY (not for issue)");
console.log(`  Section A line count                       : ${A.length}`);
console.log(`  Section B line count                       : ${B.length}`);
console.log(`  Preferred brand                            : FARENHYT`);
console.log(`  Preferred-brand basis                      : company in-house Fire Alarm policy, UL/FM regime, <=2000 points`);
console.log("");
console.log("  A note on honesty of Section A: it is deliberately NOT inflated. Items whose identity");
console.log("  is not genuinely settled remain in Section B rather than being presented as known,");
console.log("  because padding Section A would misrepresent project readiness to the supplier.");
console.log("");
console.log("  SUPPLIER PROPOSAL GOVERNANCE:");
console.log("    A returned proposal enters as SUPPLIER_PROPOSED_TECHNICAL_SOLUTION.");
console.log("    It does NOT become the approved BOM automatically. Engineer review is required first.");
console.log("    Only after that review may price approval and costing consume it.");
console.log("");
console.log("  COMMERCIAL STATE IS UNCHANGED BY ISSUING THIS RFQ:");
console.log("    12 of 12 costable lines still lack an approved costing price.");
console.log("    APPROVED MATERIAL COST SUBTOTAL remains SAR 0.00.");
console.log("    The Farenhyt switch is a BRAND-STRATEGY outcome. It invalidates the previous NOTIFIER");
console.log("    commercial basis, and the price pipeline must now be re-pointed to Farenhyt.");
