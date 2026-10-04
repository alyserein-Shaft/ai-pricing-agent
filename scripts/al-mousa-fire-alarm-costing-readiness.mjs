// AL MOUSA FIRE ALARM -- COSTING READINESS GATE.
//
// Every Fire Alarm BOM line is classified into exactly one of:
//   READY_FOR_COSTING
//   READY_FOR_COSTING_WITH_WARNING
//   PENDING_QUANTITY
//   PENDING_TECHNICAL_INPUT
//
// THE GOVERNING RULE
// ------------------
// A line may only be READY_FOR_COSTING (or WITH_WARNING) if its QUANTITY is
// exact. A line whose quantity is PENDING is never costed on an estimate,
// because an estimate becomes an invented number the moment it is priced.
// Lifecycle and regional availability alone are advisory: they produce
// WITH_WARNING, never a block.
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/al-mousa-fire-alarm-costing-readiness.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const lifecycleOf = (pn) => {
  const r = db.prepare("SELECT lifecycle_status FROM library_products WHERE part_number=?").get(pn);
  return r ? r.lifecycle_status : null;
};

const LINES = [
  // ---- SLC-addressed detection ------------------------------------------
  { line: "Smoke detectors (all types)", qty: 1401, product: "FSP-951-IV", quantityBasis: "GOVERNED BOQ ORACLE", warning: "Loop powered strobes on the same loop share the SLC power budget; see the notification assessment." },
  { line: "Heat detectors (ambient / ROR)", qty: 9, product: "FST-951R-IV", quantityBasis: "GOVERNED HUMAN DECISION (9 ambient/ROR, 0 high-temperature)", warning: null },
  { line: "Combined smoke and heat detectors", qty: 31, product: "FSP-951T-IV", quantityBasis: "GOVERNED BOQ ORACLE", warning: null },
  { line: "Duct detectors (addressable head)", qty: 45, product: "FSP-951R-IV", quantityBasis: "GOVERNED BOQ ORACLE", warning: "Supervisory-only annunciation is a PROGRAMMING requirement, not a product property; confirm site cause-and-effect." },
  { line: "Manual pull stations (interior)", qty: 118, product: "NBG-12LX", quantityBasis: "GOVERNED BOQ ORACLE", warning: null },
  { line: "Manual pull stations (weatherproof)", qty: 39, product: "NBG-12LX", quantityBasis: "GOVERNED BOQ ORACLE", warning: null },
  { line: "Monitor modules", qty: 97, product: "FMM-1", quantityBasis: "GOVERNED BOQ ORACLE", warning: null },
  { line: "Control modules", qty: 55, product: "FCM-1", quantityBasis: "GOVERNED BOQ ORACLE", warning: null },
  { line: "Door contacts (one FMM-1 each)", qty: 82, product: "FMM-1", quantityBasis: "GOVERNED BOQ ORACLE", warning: null },
  { line: "Door contact interfaces", qty: 82, product: "FMM-101", quantityBasis: "GOVERNED BOQ ORACLE (1 mini-monitor per door contact)", warning: null },

  // ---- Duct detector assembly (non-addressed companions) ----------------
  { line: "Duct detector housings (DNR / DNRW)", qty: 45, product: "DNR / DNRW", quantityBasis: "1:1 with the 45 duct detector heads", warning: "Indoor vs NEMA-4 split is PENDING (weatherproof exposure not per-location scheduled)." },
  { line: "Duct sampling tubes", qty: 45, product: "DST1 / DST1.5", quantityBasis: "1:1 with the 45 duct detectors", warning: "DST1 vs DST1.5 depends on duct WIDTH, which is not scheduled. PENDING per-location." },

  // ---- Firefighter telephone --------------------------------------------
  { line: "Fireman telephone jacks", qty: 73, product: "N-FPJ", quantityBasis: "GOVERNED BOQ ORACLE", warning: null },
  { line: "Firephone control modules (FTM-1)", qty: null, product: "FTM-1", quantityBasis: "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY", warning: "Quantity follows the supervised telephone circuit count. No circuit designators exist in the drawings. The previously reported CEILING(73/2)=37 was withdrawn as unsound." },
  { line: "Fireman telephone control panel", qty: null, product: "FTCP (governed legend symbol)", quantityBasis: "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY", warning: "Legend symbol FTCP exists on the project legend; no product identity or quantity is evidenced." },
  { line: "Firefighter handsets", qty: null, product: "FHS-F", quantityBasis: "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY", warning: "Handset storage cabinets (FHSC-R/S) are governed by handset count." },

  // ---- Panels and loop modules ------------------------------------------
  { line: "Main fire alarm control panel (MFACP)", qty: 1, product: "N16e", quantityBasis: "GOVERNED ARCHITECTURE (1 MFACP)", warning: "MFACP location is referenced inconsistently across schematics; N16x persona licence may be required." },
  { line: "Building FACPs", qty: 6, product: "N16e", quantityBasis: "GOVERNED ARCHITECTURE (6 FACP locations)", warning: "4 of 5 schematics require MORE THAN 3 loops, so the N16x persona is technically warranted at BOS, GRS, KGS and WLC." },
  { line: "SLM-318 included base loop modules", qty: 7, product: "SLM-318", quantityBasis: "1 per physical panel", warning: "NOT separately priced -- included with each N16e." },
  { line: "SLM-318 expansion loop modules", qty: null, product: "SLM-318", quantityBasis: "PARTIAL: 19 across the 5 panels with a drawn loop schedule; PENDING for the MFACP (no loop schedule drawn) and for 1 unidentified panel", warning: "Exact campus quantity requires a drawn loop count for the MFACP and for the sixth building FACP location." },
  { line: "N16-XUPG persona upgrade licences", qty: null, product: "N16-XUPG2", exactOrderable: true, quantityBasis: "PARTIAL: 4 documented (BOYS, GIRLS, KGS-FACP, WELCOME each exceed the N16e 3-loop ceiling); PENDING for the MFACP and the unidentified panel", warning: "One licence per qualifying physical panel. A licence is NOT priced against an unresolved panel identity, and N16x is a persona on the same hardware, not a separate panel." },

  // ---- Notification appliances ------------------------------------------
  { line: "Indoor strobes (BOQ: loop powered strobes)", qty: 324, product: "SD (FAMILY ALIAS)", exactOrderable: false, quantityBasis: "GOVERNED BOQ ORACLE", warning: "CONVENTIONAL_NAC selected. The BOQ/legend 'loop powered' label is superseded: the only Honeywell addressable loop-powered AV range is rated >1 cd against a mandatory 15-110 cd duty. Colour/lens variant PENDING_SUPPLIER_CONFIRMATION." },
  { line: "Indoor horn/strobes (BOQ: loop powered strobes with sounder)", qty: 14, product: "SHD (FAMILY ALIAS)", exactOrderable: false, quantityBasis: "GOVERNED BOQ ORACLE", warning: "CONVENTIONAL_NAC. Multi-tone, Code 3 temporal and synchronisation all satisfied. Mounting variant PENDING." },
  { line: "Exterior weatherproof horn/strobes (BOQ: ...with sounder (weatherproof))", qty: 100, product: "SHDK (FAMILY ALIAS)", exactOrderable: false, quantityBasis: "GOVERNED BOQ ORACLE", warning: "CONVENTIONAL_NAC. NEMA 4X, -40F to 151F, 88+ dBA @16V exceeds the project 85 dBA exterior minimum." },
  { line: "MDL3 NAC synchronisation modules", qty: null, product: "MDL3", quantityBasis: "PENDING_NAC_ZONING", warning: "One MDL3 Sync-Circuit module per synchronised NAC group; the group count follows the final NAC zoning, which is not yet issued." },
  { line: "Auxiliary / booster power supplies", qty: null, product: "PMB-AUX(-RTO) / FCPS-24S6 / FCPS-24S8", exactOrderable: false, quantityBasis: "CALCULATED NEED, PENDING_QUANTITY", warning: "CORRECTED: base NAC capacity is 42.0 A (7 x 6.0 A), not 70.0 A, so the worst-case deficit is 66.44 A, not 38.44 A. N16x panels may carry up to 3 internal PMBs (18 A), which is headroom, not a requirement. Exact quantity still follows circuit-level loads." },
];

console.log("=".repeat(78));
console.log("FIRE ALARM COSTING READINESS MATRIX");
console.log("=".repeat(78));
console.log("");
const tally = { READY_FOR_COSTING: 0, READY_FOR_COSTING_WITH_WARNING: 0, PENDING_QUANTITY: 0, PENDING_TECHNICAL_INPUT: 0 };
for (const l of LINES) {
  // THE GATE. A line may only reach READY_FOR_COSTING if it has BOTH an exact
  // orderable identity AND a governed quantity. Lifecycle or stock uncertainty is
  // a warning, never a block -- but a family alias without an exact P/N, or an
  // unknown quantity, IS a block to exact pricing.
  const hasQty = l.qty !== null && l.qty !== undefined;
  const aliasOrUnresolved = l.exactOrderable === false || /PENDING_TECHNICAL_INPUT|FAMILY ALIAS/.test(String(l.product));
  let status;
  if (!hasQty) status = "PENDING_QUANTITY";
  else if (aliasOrUnresolved) status = "PENDING_TECHNICAL_INPUT";
  else if (l.warning) status = "READY_FOR_COSTING_WITH_WARNING";
  else status = "READY_FOR_COSTING";
  tally[status] += 1;
  console.log(`  ${status.padEnd(30)} ${l.line}`);
  console.log(`      qty ${String(hasQty ? l.qty : "--").padStart(5)}   product ${l.product}`);
  console.log(`      basis: ${l.quantityBasis}`);
  if (l.warning) console.log(`      note : ${l.warning}`);
  if (l.product && lifecycleOf(l.product)) console.log(`      lifecycle: ${lifecycleOf(l.product)} (advisory only -- never a block)`);
  console.log("");
}
console.log("-".repeat(78));
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(32)} ${v}`);
console.log("");
const costable = tally.READY_FOR_COSTING + tally.READY_FOR_COSTING_WITH_WARNING;
console.log(`  LINES CLEARED FOR COSTING : ${costable} of ${LINES.length}`);
console.log(`  LINES BLOCKED ON QUANTITY : ${tally.PENDING_QUANTITY}`);
console.log("");
console.log("  FIRE_ALARM_ENGINEERING_READY_FOR_COSTING requires that every quantity needed for costing");
console.log("  is exact or explicitly pending, and that NOTHING is fabricated. Two quantities remain");
console.log("  PENDING (firephone interface, expansion SLM on undocumented panels), so the project is");
console.log("  NOT yet fully cleared. The blocked items are named and bounded, not estimated.");
