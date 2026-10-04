// Shared, governed definition of the Al Mousa Fire Alarm COMMERCIAL BOM.
//
// Single source of truth for both the costing script and the RFQ script, so a
// commercial line can never drift between "what we cost" and "what we asked a
// supplier for".
//
// QUANTITIES ARE NEVER HARDCODED. They are derived from the canonical BOQ
// census and asserted against it, so a change in the census that breaks a
// mapping fails loudly instead of silently pricing a wrong quantity.
//
// PRODUCT IDENTITY is frozen. The technical matching phase is closed; this
// module records what was selected, not a fresh selection.
import { CLEAN_GOLDEN_BOQ_ORACLE } from "../../tests/fixtures/clean-golden-boq-oracle.mjs";

const census = (predicate) =>
  CLEAN_GOLDEN_BOQ_ORACLE.filter((l) => predicate(l.description)).reduce((t, l) => t + l.qty, 0);

export const CENSUS_Q = {
  smoke: census((d) => /Smoke detectors \((above|below) ceiling\)|Smoke detectors on slab/i.test(d)),
  heatBOQ: census((d) => /^Heat detector/i.test(d)),
  combined: census((d) => /Combined smoke and heat/i.test(d)),
  doorContact: census((d) => /^Door contact$/i.test(d)),
  duct: census((d) => /^Duct detector/i.test(d)),
  pull: census((d) => /^Fire alarm manual station/i.test(d)),
  ftJack: census((d) => /^Fireman telephone jack/i.test(d)),
  ctrlModule: census((d) => /^Interface module control/i.test(d)),
  monModule: census((d) => /^Interface module monitor/i.test(d)),
  strobe: census((d) => /^Loop powered strobes$/i.test(d)),
  strobeSounder: census((d) => /^Loop powered strobes with sounder$/i.test(d)),
  strobeWp: census((d) => /^Loop powered strobes with sounder \(weatherproof\)/i.test(d)),
  facp: census((d) => /Main fire alarm control panel|Fire alarm control panel with/i.test(d)),
};

// Canonical totals, asserted before any commercial use.
const EXPECTED = {
  smoke: 1401, heatBOQ: 26, combined: 31, doorContact: 82, duct: 45,
  pull: 157, ftJack: 73, ctrlModule: 55, monModule: 97,
  strobe: 324, strobeSounder: 14, strobeWp: 100, facp: 7,
};

export function assertCensus() {
  const bad = Object.entries(EXPECTED).filter(([k, v]) => CENSUS_Q[k] !== v);
  if (bad.length) {
    const lines = CLEAN_GOLDEN_BOQ_ORACLE.map((l) => `    ${String(l.qty).padStart(5)}  ${l.description}`).join("\n");
    throw new Error(
      "CENSUS DERIVATION FAILED -- refusing to price against a mis-derived quantity:\n" +
      bad.map(([k, v]) => `  ${k}: derived ${CENSUS_Q[k]}, canonical census expects ${v}`).join("\n") +
      "\n  census lines actually present:\n" + lines,
    );
  }
  return { lines: CLEAN_GOLDEN_BOQ_ORACLE.length, verified: Object.keys(EXPECTED).length };
}

const Q = CENSUS_Q;

// `section` drives the RFQ split. A line is only ever in ONE section:
// "A" (fixed quantity, exact P/N) or "B" (unit rate only, quantity TBD).
export const BOM = [
  // ---------------- SECTION A : exact P/N + governed quantity ----------------
  { section: "A", boq: "Smoke detectors (above/below ceiling and on slab)", pn: "FSP-951-IV", mfr: "Notifier", unit: "No", qty: Q.smoke, boqQty: Q.smoke, role: "Detector, SLC addressable", lifecycle: "CURRENT" },
  { section: "A", boq: "Heat detectors (ambient / ROR)", pn: "FST-951R-IV", mfr: "Notifier", unit: "No", qty: 9, boqQty: Q.heatBOQ, role: "Detector, SLC addressable", lifecycle: "CURRENT", note: `governed selection covers 9 of the ${Q.heatBOQ} census heat detectors; the remaining ${Q.heatBOQ - 9} are not yet selected` },
  { section: "A", boq: "Combined smoke and heat detectors", pn: "FSP-951T-IV", mfr: "Notifier", unit: "No", qty: Q.combined, boqQty: Q.combined, role: "Detector, SLC addressable", lifecycle: "CURRENT" },
  { section: "A", boq: "Duct detector heads", pn: "FSP-951R-IV", mfr: "Notifier", unit: "No", qty: Q.duct, boqQty: Q.duct, role: "Detector, SLC addressable, non-relay duct housing", lifecycle: "CURRENT" },
  { section: "A", boq: "Manual pull stations (interior + weatherproof)", pn: "NBG-12LX", mfr: "Notifier", unit: "No", qty: Q.pull, boqQty: Q.pull, role: "Manual station, SLC module address", lifecycle: "CURRENT" },
  { section: "A", boq: "Monitor modules", pn: "FMM-1", mfr: "Notifier", unit: "No", qty: Q.monModule, boqQty: Q.monModule, role: "SLC module", lifecycle: "CURRENT" },
  { section: "A", boq: "Control modules", pn: "FCM-1", mfr: "Notifier", unit: "No", qty: Q.ctrlModule, boqQty: Q.ctrlModule, role: "SLC module", lifecycle: "CURRENT" },
  { section: "A", boq: "Door contact interfaces", pn: "FMM-101", mfr: "Notifier", unit: "No", qty: Q.doorContact, boqQty: Q.doorContact, role: "SLC module", lifecycle: "CURRENT" },
  { section: "A", boq: "Duct detector housing (indoor)", pn: "DNR", mfr: "Honeywell", unit: "No", qty: Q.duct, boqQty: null, role: "Mechanical housing, 0 SLC addresses", lifecycle: "CURRENT" },
  { section: "A", boq: "Duct sampling tube (to 1 ft duct)", pn: "DST1", mfr: "Honeywell", unit: "No", qty: Q.duct, boqQty: null, role: "Mechanical, 0 SLC addresses", lifecycle: "CURRENT", warning: "DST1 suits ducts to 1 ft. If ducts exceed 1 ft the DST1.5 / DST3 / DST5 sizes apply instead; duct widths are not scheduled." },
  { section: "A", boq: "Fireman telephone jacks", pn: "N-FPJ", mfr: "Notifier", unit: "No", qty: Q.ftJack, boqQty: Q.ftJack, role: "Passive telephone device, 0 SLC addresses", lifecycle: "CURRENT" },
  { section: "A", boq: "N16 control panels (1 MFACP + 6 FACP)", pn: "N16e", mfr: "Notifier", unit: "No", qty: Q.facp, boqQty: Q.facp, role: "Control unit, physical hardware", lifecycle: "CURRENT" },

  // ---------------- SECTION B : unit rate only, quantity TBD ----------------
  { section: "B", boq: "Heat detectors not yet selected (census balance)", pn: null, mfr: "Notifier", unit: "No", qty: null, boqQty: Q.heatBOQ - 9, role: "Detector, SLC addressable", pending: "PENDING_TECHNICAL_SELECTION", note: `${Q.heatBOQ - 9} census heat detectors have no selected device` },
  { section: "B", boq: "Duct detector housing (weatherproof)", pn: "DNRW", mfr: "Honeywell", unit: "No", qty: null, boqQty: null, role: "Mechanical housing, 0 SLC addresses", pending: "PENDING_DUCT_HOUSING_TYPE_SPLIT" },
  // A slash-list of candidates is NOT an exact orderable P/N. It is carried as a
  // candidate group so the exact-identity gate applies to it honestly, exactly as
  // it does to the notification family aliases.
  { section: "B", boq: "Duct sampling tube (larger duct sizes)", pn: null, pnCandidates: ["DST1.5", "DST3", "DST5"], mfr: "Honeywell", unit: "No", qty: null, boqQty: null, role: "Mechanical", pending: "PENDING_DUCT_WIDTH_SCHEDULE" },
  { section: "B", boq: "Duct remote test station", pn: "RTS151KEY", mfr: "System Sensor", unit: "No", qty: null, boqQty: null, role: "Duct test accessory", pending: "PENDING_DUCT_LOCATION_SCHEDULE" },
  { section: "B", boq: "Firephone control module", pn: "FTM-1", mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "SLC module", pending: "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY", rule: "quantity derives from telephone circuit topology, never from the 73 jack count" },
  { section: "B", boq: "Fireman telephone control panel", pn: null, mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "Telephone system component", pending: "PENDING_EXACT_PN_AND_TELEPHONE_CIRCUIT_TOPOLOGY" },
  { section: "B", boq: "Firefighter handsets", pn: "FHS-F", mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "Telephone system component", pending: "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY" },
  { section: "B", boq: "Handset storage cabinets", pn: null, mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "Telephone system component", pending: "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY" },
  { section: "B", boq: "SLM-318 expansion loop modules", pn: "SLM-318", mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "Expansion loop module", pending: "PENDING_MFACP_AND_UNIDENTIFIED_PANEL_LOOPS", rule: "sized from drawing-evidenced loop counts, never from capacity arithmetic; 19 documented so far" },
  { section: "B", boq: "N16x persona upgrade licence", pn: "N16-XUPG2", mfr: "Notifier", unit: "Licence", qty: null, boqQty: null, role: "Software licence", pending: "PENDING_MFACP_AND_UNIDENTIFIED_PANEL_PERSONA", rule: "evaluated only where required loops at a panel exceed 3, or an N16x-only function applies -- never inferred from panel count or from additional SLM count" },
  { section: "B", boq: "NAC synchronisation module", pn: "MDL3", mfr: "System Sensor", unit: "No", qty: null, boqQty: null, role: "Sync module", pending: "PENDING_NAC_ZONING", rule: "topology-driven only -- never inferred from the mere existence of strobes" },
  { section: "B", boq: "Auxiliary power module (internal PMB-AUX)", pn: null, mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "NAC expansion power", pending: "PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION" },
  { section: "B", boq: "Remote / booster power supply", pn: null, mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "NAC expansion power", pending: "PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION" },
  // `internalNote` is INTERNAL-ONLY provenance and is deliberately NEVER rendered
  // into the supplier-facing RFQ. Naming an internal document there would reveal
  // our existing sourcing position to a bidder and could anchor their pricing.
  // `note` and `warning` are supplier-SAFE and are rendered as REMARKs.
  { section: "B", boq: "Detector mounting bases", pn: null, mfr: "Notifier", unit: "No", qty: null, boqQty: null, role: "Detector accessory, 0 SLC addresses", pending: "PENDING_BASE_TYPE_PER_DETECTOR", internalNote: "the project's own FA-RFQ-Farenhyt schedule lists detector bases as separate line items; the governed BOM carries no priced base line" },

  // Notification families: quantity is governed but the exact P/N is not.
  // They stay PENDING_EXACT_PN and are quoted as a candidate set, never as a SKU.
  { section: "B", boq: "Indoor strobes", pn: null, familyAlias: "SD", mfr: "System Sensor", unit: "No", qty: Q.strobe, boqQty: Q.strobe, role: "Conventional NAC appliance", lifecycle: "CURRENT", pending: "PENDING_EXACT_PN", quotedAs: "CANDIDATE_RATE_ONLY" },
  { section: "B", boq: "Indoor horn/strobes", pn: null, familyAlias: "SHD", mfr: "System Sensor", unit: "No", qty: Q.strobeSounder, boqQty: Q.strobeSounder, role: "Conventional NAC appliance", lifecycle: "CURRENT", pending: "PENDING_EXACT_PN", quotedAs: "CANDIDATE_RATE_ONLY" },
  { section: "B", boq: "Exterior weatherproof horn/strobes", pn: null, familyAlias: "SHDK", mfr: "System Sensor", unit: "No", qty: Q.strobeWp, boqQty: Q.strobeWp, role: "Conventional NAC appliance", lifecycle: "CURRENT", pending: "PENDING_EXACT_PN", quotedAs: "CANDIDATE_RATE_ONLY" },
];

// SLM-318 base modules ship included with each N16 and are never separately priced.
export const INCLUDED_LINES = [
  { boq: "SLM-318 included base loop modules", pn: "SLM-318", mfr: "Notifier", qty: Q.facp, role: "INCLUDED with each N16 -- NOT separately priced" },
];
