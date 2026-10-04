// AL MOUSA FIRE ALARM -- ENGINEER INPUT PACKET.
//
// Exactly FIVE remaining project inputs. Nothing else is asked.
//
// DISCIPLINE: this packet must not ask a question that governed project evidence
// has already answered. Where evidence already narrows a decision, the evidence
// is stated first and the question is reduced to the confirmation that only the
// engineer can give. That is why INPUT-1 is narrower than it was.

const bar = (t) => { console.log(""); console.log("=".repeat(112)); console.log(t); console.log("=".repeat(112)); };

bar("AL MOUSA FIRE ALARM -- ENGINEER INPUT REQUEST (INPUT-1 .. INPUT-5 ONLY)");
console.log("Everything else on this project is closed. The technical matching phase is complete and");
console.log("is not being reopened. These five inputs are the only outstanding engineering questions,");
console.log("and each one unblocks named commercial lines.");

const INPUTS = [
  {
    id: "INPUT-1",
    title: "NOTIFICATION APPLIANCES",
    alreadyKnown: [
      "Architecture is settled: CONVENTIONAL_NAC, System Sensor / Wheelock / Gentex conventional appliances.",
      "The Honeywell loop-powered (addressable) range was evaluated and REJECTED -- strobe flash intensity is not rated in cd, so it cannot meet the mandatory 15-110 cd band.",
      "The project's own Jan-2026 KSA fire price book prices candidates for wall AND ceiling, red AND white, and indoor AND outdoor.",
      "The project's own FA-RFQ-Farenhyt RFQ schedule independently names only WALL / RED / 2-WIRE parts, with one outdoor variant. That corroborates wall mount but does not decide it.",
      "Quantities are already governed and final: 324 indoor strobes, 14 indoor horn/strobes, 100 exterior weatherproof horn/strobes.",
    ],
    need: [
      "Mounting per location: WALL or CEILING (and whether it differs between indoor strobes and indoor horn/strobes).",
      "Colour / finish: RED or WHITE, per family.",
      "Wiring: 2-wire or 4-wire.",
      "Candela: the required output per space, or the candela range/variant to be used. This is the only discriminator the project evidence genuinely cannot supply.",
    ],
    unlocks: [
      "Exact orderable P/N for 3 lines totalling 438 appliances.",
      "PENDING_EXACT_PN -> PENDING_QUANTITY-then-READY: the largest single quantity block in the project.",
      "Whether MDL3 synchronisation is needed at all (INPUT-4 depends on this).",
    ],
    format: "One line per family, e.g. 'Indoor strobes: wall, red, 2-wire, 15/30/75/110 cd selectable'. A room-by-room candela schedule is ideal; a single acceptable range per family is sufficient.",
  },
  {
    id: "INPUT-2",
    title: "FINAL PANEL ALLOCATION",
    alreadyKnown: [
      "Seven panels: 1 campus MFACP + 6 FACP.",
      "KGS is the FIRE COMMAND CENTRE (campus MFACP) and separately has its own building FACP.",
      "Drawn SLC loop counts: BOYS 6, GIRLS 6, KGS-FACP 6, WELCOME 4, SUBSTATION 2 (24 drawn).",
      "Persona is established for 5 panels: BOYS / GIRLS / KGS / WELCOME = N16x, SUBSTATION = N16e.",
      "The 6th FACP is still unnamed: drawings cover BOS, GRS, KGS, WLC, AMS-SUB; the architecture names SUB STATION-1, SUB STATION-2, BOS, GRS, WLC, DG STATION.",
    ],
    need: [
      "Identity of the sixth FACP.",
      "Device/loop allocation for the MFACP (KGS).",
      "The BOQ/device-to-panel allocation, so each device quantity is attributed to one panel.",
    ],
    unlocks: [
      "SLM-318 expansion loop module quantity (19 documented so far, plus the MFACP and the unidentified panel).",
      "N16-XUPG2 persona licence quantity (4 documented so far).",
      "Per-panel NAC and power allocation, which is a precondition for INPUT-4.",
    ],
    format: "A panel-by-panel table: panel name, building, loop count, device count. An exported panel schedule from the design tool is ideal.",
    note: "A LOOP COUNT ALONE IS NOT SUFFICIENT. The allocation is what resolves the licence and the expansion-module quantity.",
  },
  {
    id: "INPUT-3",
    title: "FIREMAN TELEPHONE",
    alreadyKnown: [
      "73 fireman telephone jacks (N-FPJ), each a PASSIVE single-gang device consuming ZERO SLC addresses.",
      "No drawing anywhere carries a telephone circuit designator.",
      "An earlier CEILING(73/2) = 37 derivation has been formally WITHDRAWN as unsound.",
    ],
    need: [
      "Telephone riser arrangement.",
      "Circuit topology.",
      "Number of supervised telephone circuits.",
      "Phones / topology per circuit where applicable.",
    ],
    unlocks: ["FTM-1 quantity.", "Fireman telephone control panel (FTCP) exact P/N and quantity.", "Firefighter handset quantity and handset-cabinet quantity."],
    format: "Circuit count plus devices per circuit, or the telephone riser schematic.",
    rule: "73 jacks does NOT imply 73 FTM-1, and does NOT imply 37 FTM-1. The quantity comes from circuit topology only.",
  },
  {
    id: "INPUT-4",
    title: "NAC ZONING AND POWER",
    alreadyKnown: [
      "Notification is CONVENTIONAL_NAC.",
      "Internal power: 1 PMB = 4 NACs, 1 NAC = 1.5 A, 1 PMB total = 6 A. N16e allows 1 PMB; N16x allows base + up to 2 PMB-AUX = 3 PMBs = 18 A theoretical.",
      "The five panels with an established persona have a known theoretical maximum of 78 A (4 x 18 A + 1 x 6 A). This is a CAPABILITY figure only -- no sufficiency conclusion has been drawn from it.",
      "The specification clause 'up to 2.5 amps per circuit' describes a SEPARATE ADDRESSABLE REMOTE POWER SUPPLY under article 10.0, not the N16 internal PMB. It is therefore not a capability conflict against the N16. What remains open is selecting and quantifying that remote supply.",
    ],
    need: [
      "Panel -> NAC assignment.",
      "Candela setting per circuit (from INPUT-1).",
      "Tone setting per circuit.",
      "Class A or Class B per circuit.",
      "Circuit routing and circuit length.",
    ],
    unlocks: [
      "NAC current, voltage drop and battery load per circuit.",
      "Power-supply requirement, i.e. the PMB-AUX and remote/booster supply quantities.",
      "Whether MDL3 synchronisation is required on each NAC, or whether the power supply provides it.",
      "Whether any single circuit exceeds 1.5 A and therefore needs splitting or a remote supply.",
    ],
    format: "A NAC schedule: one row per circuit with panel, device count, candela, tone, class, and approximate length.",
    rule: "MDL3 is NOT inferred from the existence of strobes. Synchronisation may instead come from a compatible power supply, PMB-AUX, or another manufacturer-supported architecture. MDL3 is included only where the topology actually requires it.",
    note: "Power adequacy is PANEL-LOCAL and CIRCUIT-LOCAL. A campus aggregate current cannot answer it.",
  },
  {
    id: "INPUT-5",
    title: "DUCT ACCESSORIES",
    alreadyKnown: [
      "45 duct detectors.",
      "Each uses an FSP-951R-IV head in a non-relay housing; the head carries the single detector-side address. Housing, sampling tube and remote test station consume ZERO SLC addresses.",
      "Candidate sizes exist for both the housing type and the tube length.",
    ],
    need: ["For each of the 45 locations: INDOOR or OUTDOOR (wet-exposed).", "Duct WIDTH at each location."],
    unlocks: [
      "DNR vs DNRW quantity split (currently the weatherproof line is PENDING, not zero).",
      "DST1 / DST1.5 / DST3 / DST5 tube-size split (currently PENDING).",
      "Remote test station (RTS) quantity.",
    ],
    format: "A per-location list, or a rule (e.g. 'all outdoor AHU locations') with the duct widths.",
    rule: "No indoor/outdoor split is inferred or invented. Until this is supplied, both lines stay explicitly pending rather than being defaulted to zero.",
  },
];

for (const i of INPUTS) {
  bar(`${i.id} -- ${i.title}`);
  console.log("ALREADY ESTABLISHED BY GOVERNED EVIDENCE (not re-opened, not re-asked)");
  for (const k of i.alreadyKnown) console.log(`    - ${k}`);
  if (i.rule) { console.log(""); console.log("GOVERNING RULE"); console.log(`    ${i.rule}`); }
  if (i.note) { console.log(""); console.log("NOTE"); console.log(`    ${i.note}`); }
  console.log("");
  console.log("WHAT WE NEED FROM YOU");
  for (const n of i.need) console.log(`    * ${n}`);
  console.log("");
  console.log("WHAT IT UNBLOCKS");
  for (const u of i.unlocks) console.log(`    -> ${u}`);
  console.log("");
  console.log("ACCEPTABLE ANSWER FORMAT");
  console.log(`    ${i.format}`);
}

bar("PRIORITY");
console.log("  Highest value first, by how many commercial lines each input unblocks:");
console.log("    1. INPUT-4  NAC circuit schedule   -> clears MDL3, PMB-AUX and all booster supplies,");
console.log("                                          and is a precondition for the power answer.");
console.log("    2. INPUT-2  MFACP loop/allocation -> clears expansion SLM-318 and N16-XUPG2.");
console.log("    3. INPUT-1  notification spec      -> clears the 3 notification P/Ns (438 appliances),");
console.log("                                          which is the largest quantity block.");
console.log("    4. INPUT-3  telephone topology     -> clears FTM-1, FTCP and handsets.");
console.log("    5. INPUT-5  duct locations         -> clears DNR/DNRW and tube-size splits.");
console.log("");
console.log("  Note that none of these five inputs is the current critical path for COSTING.");
console.log("  The critical path is commercial: an authorised Honeywell/NOTIFIER supplier quotation.");
console.log("  Every one of these inputs improves the BOM, but the RFQ can be issued today and");
console.log("  its Section A lines are already complete.");
