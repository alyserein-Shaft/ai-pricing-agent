// AL MOUSA FIRE ALARM -- PRELIMINARY FARENHYT TECHNICAL SOLUTION.
//
// Purpose: produce ENOUGH selection to engage a supplier. Per
// docs/fire-alarm-brand-and-pre-sales-policy.md section 4, the internal engineer
// does NOT have to resolve 100% of exact P/Ns and accessories before RFQ. The
// supplier completes detailed selection; the engineer then reviews it.
//
// Every candidate below comes from EXISTING GOVERNED knowledge in the project:
// the FA-RFQ-Farenhyt supplier RFQ schedule (52 part numbers, Honeywell/Farenhyt,
// UL + FM + EN54). Nothing was rebuilt from zero and no new product was invented.
//
// Where the governed corpus does not settle a requirement, the line is marked
// SUPPLIER_DETAILED_SELECTION_REQUIRED rather than forced to a P/N.
import { CENSUS_Q, assertCensus } from "./lib/al-mousa-fire-alarm-commercial-bom.mjs";
import { FARENHYT_PLATFORM } from "./lib/al-mousa-farenhyt-platform.mjs";

assertCensus();
const bar = (t) => { console.log(""); console.log("=".repeat(112)); console.log(t); console.log("=".repeat(112)); };

// ---------------------------------------------------------------------------
// GOVERNED FARENHYT PLATFORM EVIDENCE
// Lives in scripts/lib/al-mousa-farenhyt-platform.mjs so the RFQ can consume it
// without executing this script. Re-exported for a single stable import path.
// ---------------------------------------------------------------------------
export { FARENHYT_PLATFORM };

// ---------------------------------------------------------------------------
// PRELIMINARY MAPPING: Al Mousa BOQ family -> Farenhyt candidate
// ---------------------------------------------------------------------------
const SOLUTION = [
  { boq: "Smoke detectors (above/below ceiling, on slab)", qty: CENSUS_Q.smoke, pool: "detector",
    product: "IDP-PHOTO-IV", family: "Intelligent Addressable Photoelectric Smoke Detector (Ivory), base not included",
    accessory: "B501-IV 4\" flangeless mounting base", confidence: "HIGH",
    evidence: "Corpus: 'Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)'",
    remaining: "Base colour (ivory vs white) and any decor/smooth-ceiling cover; quantity of B501-BL." },

  { boq: "Heat detectors (ambient / ROR)", qty: 9, pool: "detector",
    product: "IDP-HEAT-IV", family: "Intelligent Addressable Thermal Detector Fixed Temp 135F (base not included)",
    accessory: "B501-IV", confidence: "MEDIUM",
    evidence: "Corpus states FIXED 135F. The governed Al Mousa requirement is ROR at 15F/min.",
    remaining: "SUPPLIER_DETAILED_SELECTION_REQUIRED -- the governed corpus entry is fixed-temperature only. Confirm whether IDP-HEAT-IV provides ROR, or nominate the correct ROR-capable part. Do NOT assume ROR capability from the fixed-temperature description." },

  { boq: "Combined smoke and heat detectors", qty: CENSUS_Q.combined, pool: "detector",
    product: "IDP-PHOTO-T-IV", family: "Intelligent Addressable Photoelectric Smoke Detector with Thermal 135F (base not included)",
    accessory: "B501-IV", confidence: "HIGH",
    evidence: "Corpus: 'Intelligent Addressable Photoelectric Smoke Detector with Thermal (135F)(57C)'",
    remaining: "Base colour only." },

  { boq: "Duct detectors", qty: CENSUS_Q.duct, pool: "detector",
    product: "DNR + IDP-PHOTO-IV head", family: "InnovairFlex intelligent duct detector, non-relay, does not include head",
    accessory: "ST-10 sampling tube (8-10 ft ducts) + RI/007C response indicator + FM996-L8 holder",
    confidence: "HIGH for the housing and head; MEDIUM for the tube length",
    evidence: "Corpus: DNR is non-relay and 'does not include head', so the head carries the single address. This is the SAME DNR housing already priced, so the Farenhyt switch does not orphan that evidence.",
    remaining: "Duct widths and indoor/outdoor split are unscheduled, so the sampling-tube length (ST-10 vs other) and the DNR vs DNRW choice remain open." },

  { boq: "Manual pull stations", qty: CENSUS_Q.pull, pool: "module",
    product: "IDP-PULL-DA", family: "Intelligent Addressable Pull Station, Single Action, Key Reset",
    accessory: "surface backbox", confidence: "HIGH",
    evidence: "Corpus describes a single-action key-reset addressable pull station.",
    remaining: "The 157 quantity mixes interior and weatherproof BOQ lines; the outdoor variant and backbox are supplier selection." },

  { boq: "Monitor modules (BOQ 'Interface module monitor')", qty: CENSUS_Q.monModule, pool: "module",
    product: "IDP-MONITOR", family: "Intelligent Addressable Monitor Module, Supervised, Single Contact",
    accessory: "SMB-series surface backbox", confidence: "HIGH",
    evidence: "Corpus: supervised single contact, which matches a monitor duty.",
    remaining: "Backbox and any multi-point where a zone needs more than one input." },

  { boq: "Control modules (BOQ 'Interface module control')", qty: CENSUS_Q.ctrlModule, pool: "module",
    product: "IDP-CONTROL", family: "Intelligent Addressable Supervised Control Module",
    accessory: "SMB-series surface backbox", confidence: "HIGH",
    evidence: "Corpus: supervised control module.",
    remaining: "Field device load per control point; relay ratings if any load exceeds the standard output." },

  { boq: "Door contact interfaces", qty: CENSUS_Q.doorContact, pool: "module",
    product: "IDP-MONITOR (or IDP-MINIMON)", family: "Addressable Monitor Module / Mini Monitor Module, supervised single contact",
    accessory: "SMB-series surface backbox", confidence: "MEDIUM",
    evidence: "A door contact is a supervised dry-contact input, which is a monitor duty. Both IDP-MONITOR and IDP-MINIMON appear in the governed corpus.",
    remaining: "SUPPLIER_DETAILED_SELECTION_REQUIRED -- choose full IDP-MONITOR vs mini IDP-MINIMON on backbox space. Do not force one." },

  { boq: "Fireman telephone jacks", qty: CENSUS_Q.ftJack, pool: "none (passive)",
    product: "FFT-FPJ", family: "Fire Fighter Phone Jack",
    accessory: "single-gang plate", confidence: "HIGH",
    evidence: "Corpus: FFT-FPJ is a PASSIVE device that draws no current. The addressable telephone interface is a separate module, so 73 jacks is NOT 73 modules.",
    remaining: "Telephone riser and circuit topology, which drives the FTM-side module quantity." },

  { boq: "Firephone control module", qty: null, pool: "module",
    product: null, family: "Addressable telephone interface module",
    accessory: null, confidence: "PENDING",
    evidence: "Quantity derives from telephone CIRCUIT TOPOLOGY, never from the 73 jack count. No telephone designators exist on any drawing.",
    remaining: "SUPPLIER_DETAILED_SELECTION_REQUIRED once circuit topology is issued." },

  { boq: "Fireman telephone control panel", qty: null, pool: "panel accessory",
    product: "IFP-FFT", family: "Farenhyt Fire Fighter Telephone Control Panel",
    accessory: null, confidence: "MEDIUM",
    evidence: "Corpus names IFP-FFT as the Farenhyt firefighter telephone control panel.",
    remaining: "Quantity TBD with circuit topology; confirm whether it is required given the phone-jack count." },

  { boq: "Firefighter handsets and cabinets", qty: null, pool: "none",
    product: "FFT-RHS + FFT-HSC", family: "Remote Handset / Fire Fighters Handset Cabinet (holds up to 10 handsets)",
    accessory: null, confidence: "MEDIUM",
    evidence: "Corpus names both. FFT-HSC holds up to 10 handsets, which bounds cabinet quantity from handset quantity.",
    remaining: "Handset count depends on the telephone system architecture, not the jack count." },

  { boq: "Indoor / outdoor notification appliances", qty: CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp, pool: "none (conventional NAC)",
    product: "System Sensor SRLED / P2RLED / P2GRKLED", family: "Conventional NAC strobe and horn/strobe",
    accessory: "mounting backboxes", confidence: "FAMILY LEVEL ONLY",
    evidence: "IMPORTANT: the Farenhyt RFQ schedule ALREADY contains these System Sensor parts (SRLED, P2RLED, P2GRKLED). The notification family decision is therefore UNCHANGED by the brand switch, and the same governed candidate analysis applies.",
    remaining: "FINAL P/N PENDING PROJECT INPUT (wall/ceiling, colour, candela). Supplier to propose per candidate. A Farenhyt IFP-2100HV carries EIGHT on-board Flexput circuits, which materially changes NAC power planning versus the previous basis." },

  { boq: "Control panel (1 MFACP + 6 FACP)", qty: CENSUS_Q.facp, pool: "none",
    product: "IFP-2100HV", family: "2100-point addressable FACP, UL + FM, 8 on-board Flexput NAC circuits",
    accessory: "5815RMK expansion kits + 6815 loop cards", confidence: "HIGH",
    evidence: "UL Listed AND FM Approved, which satisfies the Mandatory tender requirement that every component be UL listed under a single manufacturer.",
    remaining: "Final panel count and loop distribution; loop count is preliminary below." },
];

// ===========================================================================
bar("F. PRELIMINARY FARENHYT TECHNICAL SOLUTION");
console.log("  Source of every candidate below: EXISTING GOVERNED project knowledge");
console.log("  (FA-RFQ-Farenhyt.xlsx supplier RFQ schedule, 52 part numbers, Honeywell/Farenhyt, UL+FM+EN54).");
console.log("  Nothing was rebuilt from zero. No product was invented.");
console.log("");
for (const s of SOLUTION) {
  console.log(`  ${s.boq}`);
  console.log(`      quantity            : ${s.qty ?? "TBD -- " + s.remaining?.slice(0, 40)}`);
  console.log(`      preliminary product : ${s.product ?? "PENDING"}`);
  console.log(`      family              : ${s.family}`);
  if (s.accessory) console.log(`      accessory           : ${s.accessory}`);
  console.log(`      SLC role            : ${s.pool}`);
  console.log(`      confidence          : ${s.confidence}`);
  console.log(`      evidence            : ${s.evidence}`);
  console.log(`      supplier detail left: ${s.remaining}`);
  console.log("");
}

// ===========================================================================
bar("G. PRELIMINARY LOOP AND PANEL SIZING  --  PRELIMINARY DESIGN ASSUMPTION");
// ===========================================================================
console.log("  *** THESE FIGURES ARE A PRELIMINARY DESIGN ASSUMPTION, NOT FINAL DETAILED DESIGN. ***");
console.log("");
console.log("  Policy: docs/fire-alarm-brand-and-pre-sales-policy.md section 5. An unresolved FINAL");
console.log("  loop distribution is reported as a stated preliminary assumption instead of blocking");
console.log("  the quotation.");
console.log("");

const detPts = CENSUS_Q.smoke + 9 + CENSUS_Q.combined + CENSUS_Q.duct;
const modPts = CENSUS_Q.pull + CENSUS_Q.monModule + CENSUS_Q.ctrlModule + CENSUS_Q.doorContact;
const perLoopDet = FARENHYT_PLATFORM.panel.perLoopDetectors;
const perLoopMod = FARENHYT_PLATFORM.panel.perLoopModules;
const loopsForDet = Math.ceil(detPts / perLoopDet);
const loopsForMod = Math.ceil(modPts / perLoopMod);
const loopsNeeded = Math.max(loopsForDet, loopsForMod);

console.log("  Governed device demand, counted via the SLC classifier:");
console.log(`      detector-pool points            : ${detPts}`);
console.log(`        smoke ${CENSUS_Q.smoke} + heat 9 + combined ${CENSUS_Q.combined} + duct heads ${CENSUS_Q.duct}`);
console.log(`      module-pool points              : ${modPts}`);
console.log(`        pull ${CENSUS_Q.pull} + monitor ${CENSUS_Q.monModule} + control ${CENSUS_Q.ctrlModule} + door ${CENSUS_Q.doorContact}`);
console.log(`      TOTAL                           : ${detPts + modPts}`);
console.log("");
console.log("  Manufacturer limits (IFP-2100HV, governed corpus):");
console.log(`      ${perLoopDet} detectors AND ${perLoopMod} modules per SLC loop`);
console.log(`      ${FARENHYT_PLATFORM.panel.loopsInBuild} loop card in the panel; +${FARENHYT_PLATFORM.panel.loopsPerExpansionKit} per 5815RMK (holds two 6815 loop cards)`);
console.log("");
console.log("  Preliminary arithmetic:");
console.log(`      loops for detectors : ${detPts} / ${perLoopDet} = ${(detPts / perLoopDet).toFixed(2)} -> ${loopsForDet} loops`);
console.log(`      loops for modules   : ${modPts} / ${perLoopMod} = ${(modPts / perLoopMod).toFixed(2)} -> ${loopsForMod} loops`);
console.log(`      PRELIMINARY LOOP REQUIREMENT : ${loopsNeeded} loops`);
console.log(`        (detectors are the binding constraint; the same loops carry the module load easily)`);
console.log("");
const panels = CENSUS_Q.facp;
const inbuildLoops = panels * FARENHYT_PLATFORM.panel.loopsInBuild;
const kitsNeeded = Math.max(0, Math.ceil((loopsNeeded - inbuildLoops) / FARENHYT_PLATFORM.panel.loopsPerExpansionKit));
console.log(`  Panel count: ${panels} (1 campus MFACP + 6 FACP)`);
console.log(`      This is a GOVERNED ARCHITECTURAL fact from the BOQ and the approved drawing architecture,`);
console.log(`      NOT a capacity calculation. Capacity alone would allow ceil(${detPts + modPts}/${FARENHYT_PLATFORM.panel.panelPointCapacity}) = ${Math.ceil((detPts + modPts) / FARENHYT_PLATFORM.panel.panelPointCapacity)} panel(s).`);
console.log(`      The governed seven-panel architecture is retained; capacity is not allowed to override it.`);
console.log(`      in-build loops across ${panels} panels : ${inbuildLoops}`);
console.log(`      PRELIMINARY expansion kits (5815RMK)  : ${kitsNeeded}   (gives ${inbuildLoops + kitsNeeded * FARENHYT_PLATFORM.panel.loopsPerExpansionKit} loops, >= ${loopsNeeded} required)`);
console.log("");
console.log("  EXPLICIT ASSUMPTION STATEMENT (quotation / dossier equivalent):");
console.log("    \"SLC loop quantities are preliminary and based on the current BOQ/device count.");
console.log("     Final loop and panel quantities are subject to revision upon receipt/completion of");
console.log("     the detailed Fire Alarm system design.\"");
console.log("");
console.log("  NOT assumed, and deliberately not fabricated:");
console.log("    per-building device allocation, the identity of the sixth FACP, and final loop distribution.");
console.log("    These remain open and are NOT resolved by this preliminary sizing.");

// ===========================================================================
bar("NOTIFICATION POWER -- A MATERIAL ADVANTAGE OF THE FARENHYT BASIS");
console.log(`  IFP-2100HV carries ${FARENHYT_PLATFORM.panel.onBoardNacCircuits} on-board Flexput notification circuits per panel.`);
console.log(`  Across the governed ${panels}-panel architecture that is ${panels * FARENHYT_PLATFORM.panel.onBoardNacCircuits} notification circuits available without external boosters.`);
console.log(`  Demand is ${CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp} conventional appliances.`);
console.log("");
console.log("  This resolves a question that was OPEN under the previous basis: the NAC power and");
console.log("  booster-supply quantity was PENDING because the N16 provided few internal circuits.");
console.log("  Circuit-level load, candela and voltage drop are still required before any current");
console.log("  adequacy is claimed, so no sufficiency conclusion is drawn here -- but the number of");
console.log("  circuits to be analysed is now far lower, and the booster path is less likely to be needed.");

console.log("");
console.log("=".repeat(112));
console.log(`PRELIMINARY FARENHYT SOLUTION  : established`);
console.log(`PRELIMINARY SLC LOOPS          : ${loopsNeeded}  (PRELIMINARY DESIGN ASSUMPTION)`);
console.log(`GOVERNED PANEL ARCHITECTURE    : ${panels} panels (BOQ + approved drawings, not capacity-derived)`);
console.log("=".repeat(112));
