export const IFP2100_DATASHEET_PARSER_VERSION = "ifp2100-datasheet-parser-1.0.0";
export const IFP2100_DATASHEET_SOURCE_VERSION = "351602:C:04-22";
export const IFP2100_DATASHEET_SHA256 =
  "cd7ebc1783c28637c3cfe3ccd1432beb8ce8e1b07050c84846bc2decc7df5a69";
export const IFP2100_DATASHEET_URL =
  "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf";

// Honeywell 351602 rev C, page 1 — the model/colour split is stated verbatim and
// is the ONLY thing that authorises a cabinet-colour attribute. The RFP models
// "perform the same functions as the IFP-2100(HV)(B) but do not include a
// display", so display evidence must never be copied onto them.
const MODELS = [
  { code: "IFP-2100", color: "Red", display: true },
  { code: "IFP-2100HV", color: "Red", display: true },
  { code: "IFP-2100B", color: "Black", display: true },
  { code: "IFP-2100HVB", color: "Black", display: true },
  { code: "RFP-2100", color: "Red", display: false },
  { code: "RFP-2100HV", color: "Red", display: false },
  { code: "RFP-2100B", color: "Black", display: false },
  { code: "RFP-2100HVB", color: "Black", display: false },
];

// Every entry is [attributeName, originalValue, normalizedValue, unit, page,
// section, exactText]. `exactText` MUST be a verbatim span of the datasheet:
// it is what makes the promoted fact auditable back to the page. Nothing here
// may be inferred, rounded, or carried across from another document or SKU.
const SHARED_ATTRIBUTES = [
  ["slc_loop_count", "1 (expandable)", "1", "loop", 4, "System Capacity", "Intelligent Signaling Line Circuits: 1 (expandable)"],
  ["panel_capacity", "2100 (IDP/SK) or 2032 (SD)", "2100", "points", 4, "System Capacity", "Addressable device capacity: 2100 (IDP/SK) or 2032 (SD)"],
  ["panel_capacity_sd", "2032 (SD)", "2032", "points", 4, "System Capacity", "Addressable device capacity: 2100 (IDP/SK) or 2032 (SD)"],
  ["programmable_software_zones", "999", "999", "zones", 4, "System Capacity", "Programmable software zones: 999"],
  ["output_groups", "999", "999", "groups", 4, "System Capacity", "Output groups: 999"],
  ["output_circuits", "8 (expandable)", "8", "circuits", 4, "System Capacity", "Output circuits: 8 (expandable)"],
  ["sbus_devices", "63 (any combination)", "63", "devices", 4, "System Capacity", "SBUS devices: 63 (any combination)"],
  ["detector_capacity_per_loop", "159 System Sensor® IDP/SK detectors", "159", "detectors per loop", 1, "Product overview", "The FACPs have one built-in SLC (signaling line circuit), which can support 159 System Sensor® IDP/SK detectors and 159 IDP/SK modules, or 127 Hochiki® SD protocol devices."],
  ["module_capacity_per_loop", "159 IDP/SK modules", "159", "modules per loop", 1, "Product overview", "The FACPs have one built-in SLC (signaling line circuit), which can support 159 System Sensor® IDP/SK detectors and 159 IDP/SK modules, or 127 Hochiki® SD protocol devices."],
  ["sd_device_capacity_per_loop", "127 Hochiki® SD protocol devices", "127", "devices per loop", 1, "Product overview", "The FACPs have one built-in SLC (signaling line circuit), which can support 159 System Sensor® IDP/SK detectors and 159 IDP/SK modules, or 127 Hochiki® SD protocol devices."],
  ["network_capacity", "up to 32 panels", "32", "panels", 1, "Product overview", "The IFP-2100 has interconnection capability for up to 32 panels."],
  ["network_capacity_sites", "Network support for up to 32 sites", "32", "sites", 1, "Features and Benefits", "Network support for up to 32 sites"],
  ["network_media", "copper network connection with a multi-mode or single-mode fiber connection", "copper; multi-mode fiber; single-mode fiber", null, 1, "Features and Benefits", "Network card allows copper network connection with a multi-mode or single-mode fiber connection"],
  ["cabinet_color_options", "Color: Red or Black", "Red; Black", null, 4, "Physical", "Color: Red or Black"],
  ["keypad", "12-key numeric pad", "12-key numeric", null, 2, "Keypad", "12-key numeric pad"],
  ["keypad_functions", "Acknowledge; Alarm Silence; System Reset; Drill; F1-F4 Programmable Function Keys", "Acknowledge; Alarm Silence; System Reset; Drill; F1-F4", null, 2, "Keypad", "Acknowledge Alarm Silence System Reset Drill F1-F4 Programmable Function Keys"],
  ["programmable_function_keys", "Four programmable function keys", "4", "keys", 1, "Features and Benefits", "Four programmable function keys"],
  ["led_status_indicators", "General Alarm (Red); Supervisory (Yellow); System Trouble (Yellow); System Silenced (Yellow); System Power (Green)", "General Alarm (Red); Supervisory (Yellow); System Trouble (Yellow); System Silenced (Yellow); System Power (Green)", null, 2, "LED Indicators", "General Alarm (Red) Supervisory (Yellow) System Trouble (Yellow) System Silenced (Yellow) System Power (Green)"],
  ["history_file_capacity", "History file with 1,000 event capacity", "1000", "events", 1, "Features and Benefits", "History file with 1,000 event capacity"],
  ["jumpstart_auto_programming", "JumpStart® auto programming reduces installation time", "JumpStart auto programming", null, 1, "Features and Benefits", "JumpStart® auto programming reduces installation time"],
  ["built_in_usb_interface", "Built-in USB interface for quick and easy programming", "Built-in USB", null, 1, "Features and Benefits", "Built-in USB interface for quick and easy programming"],
  ["dact", "dual technology, IP and POTS", "IP; POTS", null, 1, "Product overview", "The built-in digital alarm communicator/transmitter (DACT) is dual technology, IP and POTS."],
  ["optional_cellular_reporting", "Optional cellular reporting is available", "Optional cellular", null, 1, "Product overview", "Optional cellular reporting is available."],
  ["flexput_circuits", "(eight Class B or four Class A) NACs or auxiliary power", "8 Class B or 4 Class A NACs or auxiliary power", null, 4, "Electrical", "Flexput Circuits: Terminal block provides connections for (eight Class B or four Class A) NACs or auxiliary power."],
  ["flexput_max_current_per_circuit", "3 A", "3", "A", 4, "Electrical", "Maximum current per circuit: 3 A."],
  ["flexput_max_current_total", "9A total for all circuits", "9", "A", 4, "Electrical", "Cannot exceed 9A total for all circuits."],
  ["end_of_line_resistor", "4.7k ohm, ½ watt for Class B NACs", "4.7", "kohm", 4, "Electrical", "End-of-line resistor: 4.7k ohm, ½ watt for Class B NACs"],
  ["communication_loop", "Supervised and power-limited, Class A or Class B, 32VDC, 150mA", "Class A or Class B, 32VDC, 150mA", null, 4, "Electrical", "Communication Loop: Supervised and power-limited, Class A or Class B, 32VDC, 150mA"],
  ["relay_contact_rating", "2.5 A @ 27.4 VDC (resistive), Form C", "2.5", "A @ 27.4 VDC", 4, "Electrical", "Two Programmable Relays and One Fixed Trouble Relay: Contact rating: 2.5 A @ 27.4 VDC (resistive), Form C"],
  ["relay_count", "Two Programmable Relays and One Fixed Trouble Relay", "2 programmable + 1 fixed trouble", null, 4, "Electrical", "Two Programmable Relays and One Fixed Trouble Relay"],
  ["ac_input", "120 VAC, 60 Hz, 5A or 240VAC, 50/60Hz, 2.8A", "120 VAC 60 Hz 5A or 240 VAC 50/60 Hz 2.8A", null, 4, "Electrical", "AC Power: 120 VAC, 60 Hz, 5A or 240VAC, 50/60Hz, 2.8A"],
  ["standby_current", "230 mA", "230", "mA", 4, "Electrical", "Standby Current: 230 mA"],
  ["alarm_current", "415 mA", "415", "mA", 4, "Electrical", "Alarm Current: 415 mA"],
  ["battery_capacity_in_cabinet", "maximum of two 18 AH batteries", "2 × 18", "Ah", 4, "Electrical", "Battery: Cabinet holds maximum of two 18 AH batteries"],
  ["battery_charger_capacity", "17-55 AH", "17–55", "Ah", 4, "Electrical", "Battery Charger Capacity: 17-55 AH"],
  ["dimensions", "16.4” W x 26.4” H x 4.1” D", "416.6 W × 669.8 H × 104.1 D", "mm", 4, "Physical", "Dimensions: 16.4” W x 26.4” H x 4.1” D (41.66cm W x 67.06cm H x 10.41cm D)"],
  ["weight", "33 lbs. (15 kg.)", "15", "kg", 4, "Physical", "Weight:33 lbs. (15 kg.)"],
  ["operating_temperature", "0 – 49°C (32– 120°F)", "0–49", "°C", 4, "Temperature and Humidity Ranges", "This system meets NFPA requirements for operation at 0 – 49°C (32– 120°F)"],
  ["operating_humidity", "93% ± 2% RH (non-condensing) at 32°C ± 2°C", "93 ± 2", "% RH non-condensing", 4, "Temperature and Humidity Ranges", "and at a relative humidity 93% ± 2% RH (non-condensing) at 32°C ± 2°C (90°F ± 3°F)."],
  ["mounting", "Surface mounting or flush mounting", "Surface; Flush", null, 1, "Features and Benefits", "Surface mounting or flush mounting"],
  ["strobe_synchronization", "Selectable strobe synchronization for Amseco®, System Sensor, Wheelock®, and Gentex® devices", "Selectable strobe synchronization", null, 1, "Features and Benefits", "Selectable strobe synchronization for Amseco®, System Sensor, Wheelock®, and Gentex® devices"],
  ["protocol_families", "IDP, SK and SD device families; IDP/SK and SD devices cannot be mixed in the same fire alarm system", "IDP; SK; SD (no mixing)", null, 3, "IDP Compatible Addressable Devices", "Note: IDP/SK and SD devices cannot be mixed in the same fire alarm system."],
  ["slc_expander", "6815: SLC Expander for IDP and SK devices", "6815", null, 3, "System Expanders", "6815: SLC Expander for IDP and SK devices"],
  ["sd_slc_expander", "5815XL: SLC expander for SD devices", "5815XL", null, 3, "System Expanders", "5815XL: SLC expander for SD devices"],
  ["network_interface_card", "SK-NIC: Network Interface Card", "SK-NIC", null, 3, "Miscellaneous Accessories", "SK-NIC: Network Interface Card"],
  ["fiber_network_modules", "SK-FML: Fiber-Optic Multi Mode transmitter and receiver; SK-FSL: Fiber-Optic Single Mode transmitter and receiver", "SK-FML; SK-FSL", null, 3, "Miscellaneous Accessories", "SK-FML: Fiber-Optic Multi Mode transmitter and receiver SK-FSL: Fiber-Optic Single Mode transmitter and receiver"],
  ["remote_annunciators", "RA-2000 4x40 LCD; RA-2000GRAY 4x40 LCD; RA-1000 4x20 LCD; RA-1000R 4x20 LCD; RA-100 4x20 LCD", "RA-2000 4x40 LCD; RA-2000GRAY 4x40 LCD; RA-1000 4x20 LCD; RA-1000R 4x20 LCD; RA-100 4x20 LCD", null, 2, "Ordering Information", "RA-2000: 4x40 LCD remote fire annunciator with four programmable buttons, red RA-2000GRAY: 4x40 LCD remote fire annunciator with four programmable buttons, gray RA-1000: 4x20 LCD remote fire annunciator, gray RA-1000R: 4x20 LCD remote fire annunciator, red RA-100: 4x20 LCD remote fire annunciator, red"],
  ["led_annunciators", "5865-3: up to 30 LEDs (15 red and 15 yellow); 5865-4: up to 30 LEDs with key switches for silence and reset and a system trouble LED", "5865-3 (30 LEDs); 5865-4 (30 LEDs + silence/reset keys)", null, 2, "Ordering Information", "5865-3: LED annunciators can display up to 30 LEDs (15 red and 15 yellow) 5865-4: LED annunciators can display up to 30 LEDs (15 red and 15 yellow). Key switches for silence and reset, and a system trouble LED"],
  ["nac_power_expander", "5496: 6 amp NAC power expander with four power-limited output circuits", "5496", null, 3, "System Expanders", "5496: 6 amp NAC power expander with four power-limited output circuits"],
  ["power_supply_accessory", "RPS-1000(HV): 6A power supply with six Flexput circuits and two Form C relays", "RPS-1000; RPS-1000HV", null, 3, "System Expanders", "RPS-1000(HV): 6A power supply with six Flexput circuits and two Form C relays"],
  ["programming_software", "HFSS: Honeywell Fire Software Suite provides remote and local panel programming, detector status, event history and additional data. Databases can be uploaded/downloaded via the panel's USB port using a flash drive. Requires a PC running Microsoft® Windows®.", "HFSS (Honeywell Fire Software Suite), Windows PC", null, 4, "Software Solutions", "HFSS: Honeywell Fire Software Suite provides remote and local panel programming, detector status, event history and additional data. Databases can be uploaded/downloaded via the panel's USB port using a flash drive. Requires a PC running Microsoft® Windows®."],
];

// Page 1 states the display split: "The RFP-2100(HV)(B) performs the same
// functions as the IFP-2100(HV)(B) but does not include a display."
const DISPLAY_ONLY_ATTRIBUTES = [
  ["panel_display", "built-in display (RFP variants do not include a display)", "Built-in display", null, 1, "Product overview", "The RFP-2100(HV)(B) performs the same functions as the IFP-2100(HV)(B) but does not include a display."],
];

// Manufacturer listing/approval claims, verbatim from page 4. `status` stays
// "Unverified": a datasheet line is a manufacturer CLAIM and only becomes
// certificate-level evidence through the governed certification review path.
const LISTING_CLAIMS = [
  ["Listing claim", "UL", "S2766", 4, "Agency Listings and Approvals", "UL Listed: S2766"],
  ["Approval claim", "CSFM", "7165-0559:0505", 4, "Agency Listings and Approvals", "CSFM: 7165-0559:0505"],
  ["Approval claim", "FDNY", "COA# 6251", 4, "Agency Listings and Approvals", "FDNY COA# 6251"],
  ["Approval claim", "FM", null, 4, "Agency Listings and Approvals", "FM Approved"],
  ["Seismic claim", "California VMA", "VMA-45894-05C", 4, "Agency Listings and Approvals", "Seismic: (CA) VMA-45894-05C"],
];

// Standards compliance statements. UL 864 and UL 2572 are quoted separately
// because they appear in two different lists on two different pages, and the
// document deliberately states a 10th edition for 864 and a 2nd edition for
// 2572. Collapsing them would lose a stated edition.
const STANDARD_CLAIMS = [
  ["Standard compliance", "UL", "864", 1, "Features and Benefits", "Complies with UL 864 10th Edition"],
  ["Standard compliance", "UL", "2572", 1, "Features and Benefits", "Complies with UL 864 10th Edition and UL 2572 2nd Edition"],
  ["Standard compliance", "NFPA", "72", 4, "NFPA Standards", "NFPA 72"],
  ["Standard compliance", "NFPA", "13", 4, "NFPA Standards", "NFPA 13"],
  ["Standard compliance", "NFPA", "15", 4, "NFPA Standards", "NFPA 15"],
  ["Standard compliance", "NFPA", "16", 4, "NFPA Standards", "NFPA 16"],
  ["Standard compliance", "NFPA", "70", 4, "NFPA Standards", "NFPA 70"],
];

export const extractIfp2100Datasheet = ({ checksum, byteSize = null } = {}) => {
  // The checksum guard is the whole anti-misattribution mechanism: this parser
  // may only ever claim to have read the exact reviewed official document. Any
  // other datasheet (including the IFP-75 351605) is refused outright rather
  // than parsed on a best-effort basis.
  if (checksum !== IFP2100_DATASHEET_SHA256) {
    throw Object.assign(
      new Error("The PDF checksum does not match the reviewed official IFP-2100 datasheet (Honeywell 351602 rev C)."),
      { code: "IFP2100_DATASHEET_CHECKSUM_MISMATCH" },
    );
  }

  const products = MODELS.map((model) => {
    const attributes = SHARED_ATTRIBUTES.map(
      ([attributeName, originalValue, normalizedValue, unit, page, section, exactText]) => ({
        attributeName,
        originalValue,
        normalizedValue,
        unit,
        page,
        section,
        exactText,
        confidence: 98,
        reviewStatus: "Needs Review",
      }),
    );
    if (model.display) {
      for (const [attributeName, originalValue, normalizedValue, unit, page, section, exactText] of DISPLAY_ONLY_ATTRIBUTES) {
        attributes.push({ attributeName, originalValue, normalizedValue, unit, page, section, exactText, confidence: 96, reviewStatus: "Needs Review" });
      }
    }
    // Cabinet colour comes from the page-1 model/colour sentence, which names
    // each exact SKU. It is therefore SKU-scoped evidence, never inherited.
    const colourText = `The IFP-2100, IFP-2100HV, RFP-2100, and RFP-2100HV (red) and IFP-2100B, IFP-2100HVB, RFP-2100B, and RFP-2100HVB (black)`;
    attributes.push({ attributeName: "cabinet_color", originalValue: model.color.toLowerCase(), normalizedValue: model.color, unit: null, page: 1, section: "Product overview", exactText: colourText, confidence: 99, reviewStatus: "Needs Review" });
    const orderingText = model.code === "IFP-2100" ? "IFP-2100: Addressable fire alarm control panel, red" : model.code === "IFP-2100B" ? "IFP-2100B: Addressable fire alarm control panel, black" : "The IFP-2100, IFP-2100HV, RFP-2100, and RFP-2100HV (red) and IFP-2100B, IFP-2100HVB, RFP-2100B, and RFP-2100HVB (black)";
    attributes.push({ attributeName: "panel_role", originalValue: model.code.startsWith("RFP") ? "Remote fire panel without display" : "Fire alarm control panel with display", normalizedValue: model.code.startsWith("RFP") ? "Remote Fire Panel (no display)" : "Fire Alarm Control Panel", unit: null, page: model.code === "IFP-2100" || model.code === "IFP-2100B" ? 2 : 1, section: model.code === "IFP-2100" || model.code === "IFP-2100B" ? "Ordering Information" : "Product overview", exactText: orderingText, confidence: 99, reviewStatus: "Needs Review" });
    return {
      code: model.code,
      description: `${model.code} Farenhyt Series analog addressable fire alarm control panel, ${model.color.toLowerCase()} cabinet${model.display ? ", with display" : ", no display"}`,
      attributes,
    };
  });

  const listingClaims = LISTING_CLAIMS.map(([type, body, number, page, section, exactText]) => ({
    type, body, number, page, section, exactText, status: "Unverified", confidence: 95, reviewStatus: "Needs Review",
  }));
  const standardClaims = STANDARD_CLAIMS.map(([type, body, number, page, section, exactText]) => ({
    type, body, number, page, section, exactText, status: "Unverified", confidence: 95, reviewStatus: "Needs Review",
  }));

  return {
    source: {
      title: "IFP-2100/RFP-2100 Series — Intelligent Fire Alarm Control Panel with Communicator",
      publisher: "Honeywell Fire Solutions",
      documentType: "Product Datasheet",
      documentNumber: "351602",
      revision: "C",
      publicationDate: "2022-04-22",
      releaseMark: "04-22",
      checksum,
      byteSize,
      officialUrl: IFP2100_DATASHEET_URL,
      parserVersion: IFP2100_DATASHEET_PARSER_VERSION,
      sourceVersion: IFP2100_DATASHEET_SOURCE_VERSION,
      reviewStatus: "Needs Review",
    },
    products,
    listingClaims,
    standardClaims,
    warnings: [
      "The datasheet states 'AC Power: 120 VAC, 60 Hz, 5A or 240VAC, 50/60Hz, 2.8A' for the family but does NOT map the HV variants to a specific input voltage, so no per-SKU input voltage was recorded. This is deliberate: the IFP-75 datasheet states that mapping explicitly for its own HV models and IFP-2100 does not, and inferring it would be an unevidenced transfer between documents.",
      "The datasheet states NO character count for an IFP-2100 panel display. The only display character counts given are for the SEPARATE remote annunciators (RA-2000 4x40, RA-1000/RA-100 4x20). No panel display size was inferred.",
      "UL 864 is stated as 'UL 864 10th Edition' on page 1 (Features and Benefits) and appears in the page-4 NFPA standards list; UL 2572 is stated as 'UL 2572 2nd Edition' on page 1 only. Both are recorded from their own page rather than merged.",
      "All listing and approval statements are manufacturer CLAIMS and remain Unverified until certificate-level evidence is ingested and reviewed.",
      "No detector, base, notification-appliance, or accessory compatibility relationships were created; this datasheet establishes the panel's own identity and specifications only.",
      "Country of origin stated as U.S.A.",
    ],
  };
};