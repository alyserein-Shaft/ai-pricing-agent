// GOVERNED Farenhyt platform evidence for Al Mousa.
//
// Extracted so the preliminary solution and the RFQ can both consume it without
// importing a script whose top-level code would execute as a side effect.
//
// EVERY FIELD BELOW IS TRANSCRIBED FROM EXISTING GOVERNED PROJECT KNOWLEDGE:
// knowledge_files -> "FA-RFQ-Farenhyt.xlsx" (supplier RFQ schedule, 52 part
// numbers, Manufacturer facts "Honeywell" and "Farenhyt", Standard facts
// "UL", "FM", "FM Approved", "EN54").
//
// Nothing here was invented, and no manufacturer document was re-researched.
// Re-ingesting or re-researching Farenhyt would be wasted effort: the governed
// corpus already carries the platform facts the preliminary solution needs.
export const FARENHYT_PLATFORM = Object.freeze({
  source: "knowledge_files/FA-RFQ-Farenhyt.xlsx (governed supplier RFQ schedule)",
  manufacturer: "Honeywell Farenhyt",
  certification: "UL Listed AND FM Approved",

  panel: Object.freeze({
    pn: "IFP-2100HV",
    description:
      "Farenhyt 2100 point Addressable Fire Panel, 4 line LCD display with 40 characters per line, " +
      "One SLC loop card inbuild, 159 Detectors and 159 Modules per loop, Additional Loop cards can be " +
      "expanded through 5815RMK (Remote mounting Kit which accomodates 2 SLC Cards (6815)), Network upto " +
      "32 panels, inbuild eight on-board Flexput circuits, Built in USB interface for programming, Four " +
      "programmable function keys, 240VAC @ 50/60Hz, 2.8A, UL Listing and FM Approved, Red Cabinet",
    perLoopDetectors: 159,
    perLoopModules: 159,
    panelPointCapacity: 2100,
    loopsInBuild: 1,
    loopsPerExpansionKit: 2,
    onBoardNacCircuits: 8,
    maxPanelsPerNetwork: 32,
  }),

  // Alternative panel in the governed corpus, for scale reference only.
  panelSmall: Object.freeze({
    pn: "IFP-75HV",
    description:
      "Farenhyt 150 point Addressable Fire Panel, One SLC loop card inbuild, 75 Detectors and 75 Modules " +
      "per loop, Network upto 32 panels, inbuild two on-board Flexput circuits, UL Listing, 2.5A Power Supply",
    perLoopDetectors: 75,
    perLoopModules: 75,
    panelPointCapacity: 150,
    loopsInBuild: 1,
    onBoardNacCircuits: 2,
  }),

  loopExpander: Object.freeze({
    pn: "6815",
    description: "SLC Loop Expander which supports 159 Detectors and 159 Modules",
    perLoopDetectors: 159,
    perLoopModules: 159,
  }),

  expansionKit: Object.freeze({
    pn: "5815RMK",
    description: "Remote Mounting Kit Cabinet holds two 6815s. Red cabinet",
    loopCardsPerKit: 2,
  }),

  telephonePanel: Object.freeze({ pn: "IFP-FFT", description: "Farenhyt Fire Fighter Telephone Control Panel" }),
  distributedPower: Object.freeze({ pn: "RPS-1000HV", description: "High voltage (240V) Intelligent Distributed Power Module" }),
  annunciator: Object.freeze({ pn: "RA-2000", description: "4 X 40 (160 Character Display) Display Remote Annunciator" }),
  networkCard: Object.freeze({ pn: "SK-NIC", description: "Network Interface Card" }),
  fibreModule: Object.freeze({ pn: "SK-FSL", description: "Fiber Module, single-mode. Must use with SK-NIC" }),

  // Notification candidates. IMPORTANT: these are the SAME System Sensor parts that
  // the previous NOTIFIER-based analysis had already governed, and they are present
  // in this Farenhyt RFQ schedule. The notification family decision is therefore
  // UNCHANGED by the brand switch.
  notificationCandidates: Object.freeze({
    indoorStrobe: Object.freeze(["SRLED", "SGRLED", "SCRLED", "SGWLED", "SCWLED"]),
    indoorHornStrobe: Object.freeze(["P2RLED", "P2GRLED"]),
    outdoorHornStrobe: Object.freeze(["P2GRKLED", "P2GWKLED", "SGWKLED"]),
  }),
});
