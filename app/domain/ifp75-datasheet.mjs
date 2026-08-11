export const IFP75_DATASHEET_PARSER_VERSION = "ifp75-datasheet-parser-1.0.0";
export const IFP75_DATASHEET_SOURCE_VERSION = "351605:C:2022-03-08";
export const IFP75_DATASHEET_SHA256 = "345de143ab459db0a274a49a7b5ca86cc22c762e1476dff37bbdc38cea2bf820";
export const IFP75_DATASHEET_URL = "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351605-C.pdf?download=false";

const sharedAttributes = [
  ["panel_capacity", "150 points (IDP/SK) or 75 points (SD)", "150 IDP/SK points; 75 SD points", "points", 1, "Product overview", "The total point capacity for IDP and SK devices is a maximum of 150 points per panel. Using SD devices, the total point capacity is a maximum of 75 points per panel."],
  ["slc_loop_count", "one SLC (signaling line circuit) loop", "1", "loop", 1, "Product overview", "The IFP-75 has one SLC (signaling line circuit) loop for connecting addressable detectors"],
  ["detector_capacity", "75 System Sensor® IDP/SK sensors", "75", "detectors per loop", 1, "Product overview", "which can support 75 System Sensor® IDP/SK sensors and 75 IDP/SK modules or 75 Hochiki® SD devices per loop."],
  ["module_capacity", "75 IDP/SK modules", "75", "modules per loop", 1, "Product overview", "which can support 75 System Sensor® IDP/SK sensors and 75 IDP/SK modules or 75 Hochiki® SD devices per loop."],
  ["network_capacity", "up to 32 panels", "32", "panels", 1, "Product overview", "The IFP-75 has the interconnection capability for up to 32 panels."],
  ["display", "Four line LCD display with 20 characters per line", "4 lines × 20 characters", null, 1, "Features and Benefits", "Four line LCD display with 20 characters per line"],
  ["supported_interfaces", "dual-line DACT; IP and POTS; USB; SK-NIC copper or fiber network", "DACT:IP/POTS; USB; SK-NIC:copper/fiber", null, 1, "Product overview / Features and Benefits", "The built-in digital alarm communicator/transmitter (DACT) is dual technology, IP and POTS. Built-in USB interface for quick and easy programming. The SK-NIC Network Interface Card is used to network panels together."],
  ["total_power_output", "2.5 A max @27.4 VDC", "2.5", "A @ 27.4 VDC", 4, "Electrical", "Total Power Output: 2.5 A max @27.4 VDC"],
  ["battery_capacity_in_cabinet", "maximum of two 7 AH batteries", "2 × 7", "Ah", 4, "Electrical", "Battery: Cabinet holds maximum of two 7 AH batteries"],
  ["battery_charger_capacity", "7-35 AH", "7–35", "Ah", 4, "Electrical", "Battery Charger Capacity: 7-35 AH"],
  ["dimensions", "12.71” W x 15.12” H x 3.33” D (32.28cm W x 38.41cm H x 8.46cm D)", "322.8 W × 384.1 H × 84.6 D", "mm", 4, "Physical", "Dimensions: 12.71” W x 15.12” H x 3.33” D (32.28cm W x 38.41cm H x 8.46cm D)"],
  ["operating_temperature", "0 – 49°C (32– 120°F)", "0–49", "°C", 4, "Temperature and Humidity Ranges", "This system meets NFPA requirements for operation at 0 – 49°C (32– 120°F)"],
  ["operating_humidity", "93% ± 2% RH (non-condensing) at 32°C ± 2°C", "93 ± 2", "% RH non-condensing", 4, "Temperature and Humidity Ranges", "at a relative humidity 93% ± 2% RH (non-condensing) at 32°C ± 2°C (90°F ± 3°F)."],
];

const models = [
  { code: "IFP-75", color: "Red", input: ["120 VAC, 60 Hz, 1.5 A", "120", "VAC; 60 Hz; 1.5 A"] },
  { code: "IFP-75B", color: "Black", input: ["120 VAC, 60 Hz, 1.5 A", "120", "VAC; 60 Hz; 1.5 A"] },
  { code: "IFP-75HV", color: "Red", input: ["240 VAC, 50/60 Hz, 1A", "240", "VAC; 50/60 Hz; 1 A"] },
  { code: "IFP-75HVB", color: "Black", input: ["240 VAC, 50/60 Hz, 1A", "240", "VAC; 50/60 Hz; 1 A"] },
];

export const extractIfp75Datasheet = ({ checksum, byteSize = null } = {}) => {
  if (checksum !== IFP75_DATASHEET_SHA256) throw Object.assign(new Error("The PDF checksum does not match the reviewed official IFP-75 datasheet."), { code: "IFP75_DATASHEET_CHECKSUM_MISMATCH" });
  const products = models.map((model) => {
    const attributes = sharedAttributes.map(([attributeName, originalValue, normalizedValue, unit, page, section, exactText]) => ({ attributeName, originalValue, normalizedValue, unit, page, section, exactText, confidence: 98, reviewStatus: "Needs Review" }));
    attributes.push({ attributeName: "ac_input", originalValue: model.input[0], normalizedValue: model.input[1], unit: model.input[2], page: 4, section: "Electrical", exactText: "AC Power: 120 VAC, 60 Hz, 1.5 A (IFP-75, IFP-75B), 240 VAC, 50/60 Hz, 1A (IFP-75HV, IFP-75HVB)", confidence: 99, reviewStatus: "Needs Review" });
    const orderingText = model.code === "IFP-75" ? "IFP-75: Addressable fire alarm control panel, red" : model.code === "IFP-75B" ? "IFP-75B: Addressable fire alarm control panel, black" : model.code === "IFP-75HV" ? "IFP-75HV: same as IFP-75 but with 240VAC input" : "IFP-75HVB: same as IFP-75B but with 240VAC input";
    attributes.push({ attributeName: "cabinet_color", originalValue: model.color.toLowerCase(), normalizedValue: model.color, unit: null, page: 2, section: "Ordering Information", exactText: orderingText, confidence: 99, reviewStatus: "Needs Review" });
    return { code: model.code, description: `IFP-75 addressable fire alarm control panel, ${model.color.toLowerCase()} cabinet, ${model.input[0]}`, attributes };
  });
  const listingClaims = [
    ["Listing claim", "UL", "S2766", "UL Listed: S2766"],
    ["Approval claim", "CSFM", "7165-0559:0503", "CSFM: 7165-0559:0503"],
    ["Approval claim", "FDNY", "COA# 6299A", "FDNY: COA# 6299A"],
    ["Seismic claim", "California VMA", "VMA-45894-05C", "Seismic: (CA) VMA-45894-05C"],
  ].map(([type, body, number, exactText]) => ({ type, body, number, exactText, page: 4, section: "Agency Listings and Approvals", status: "Unverified", confidence: 90, reviewStatus: "Needs Review" }));
  return {
    source: { title: "IFP-75 Series — Intelligent Fire Alarm Control Panel with Communicator", publisher: "Honeywell Fire Solutions", documentType: "Product Datasheet", documentNumber: "351605", revision: "C", publicationDate: "2022-03-08", releaseMark: "04-22", checksum, byteSize, officialUrl: IFP75_DATASHEET_URL, parserVersion: IFP75_DATASHEET_PARSER_VERSION, sourceVersion: IFP75_DATASHEET_SOURCE_VERSION, reviewStatus: "Needs Review" },
    products,
    listingClaims,
    warnings: [
      "The page footer date is 3/8/2022 while the final-page release mark is 04-22; publication metadata needs review.",
      "Listing and approval statements are manufacturer claims only and remain Unverified until certificate-level evidence is ingested.",
      "No detector, module, repeater, card, protocol-family, lifecycle, or accessory compatibility relationships were created.",
    ],
  };
};
