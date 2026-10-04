export const HONEYWELL_6815_INSTALLATION_PARSER_VERSION =
  "honeywell-6815-installation-parser-1.0.0";

export const HONEYWELL_6815_INSTALLATION_SOURCE_VERSION =
  "LS10173-001SK-E:A:2017-07-01";

export const HONEYWELL_6815_INSTALLATION_SHA256 =
  "416aff5fcb8db87d37689c0df1c6d3cfdfbcf56b8c4d680103d4537588174482";

export const HONEYWELL_6815_INSTALLATION_URL =
  "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/LS10173-001SK-E_Manual_6815.pdf";

const attribute = (
  attributeName,
  originalValue,
  normalizedValue,
  unit,
  page,
  section,
  exactText,
  confidence = 99
) => ({
  attributeName,
  originalValue,
  normalizedValue,
  unit,
  page,
  section,
  exactText,
  confidence,
  reviewStatus: "Needs Review",
});

export const extractHoneywell6815InstallationDocument = ({
  checksum,
  byteSize = null,
} = {}) => {
  if (checksum !== HONEYWELL_6815_INSTALLATION_SHA256) {
    throw Object.assign(
      new Error(
        "The PDF checksum does not match the reviewed official Honeywell 6815 installation document."
      ),
      { code: "HONEYWELL_6815_INSTALLATION_CHECKSUM_MISMATCH" }
    );
  }

  const attributes = [
    attribute(
      "product_type",
      "6815 SLC Expander",
      "SLC Expander",
      null,
      1,
      "Title / 1.1 Description",
      "6815 SLC Expander"
    ),
    attribute(
      "compatible_panel_family",
      "compatible Honeywell Silent Knight and Farenhyt Series Fire Alarm Control Panels",
      "Honeywell Silent Knight and Farenhyt Series FACP",
      null,
      1,
      "1.2 Compatibility",
      "The 6815 is for use with compatible Honeywell Silent Knight and Farenhyt Series Fire Alarm Control Panels FACP's:",
      98
    ),
    attribute(
      "standby_current",
      "78mA",
      "78",
      "mA",
      1,
      "1.3 Specifications",
      "Standby Current: 78mA"
    ),
    attribute(
      "alarm_current",
      "78mA",
      "78",
      "mA",
      1,
      "1.3 Specifications",
      "Alarm Current: 78mA"
    ),
    attribute(
      "operating_voltage",
      "24VDC",
      "24",
      "VDC",
      1,
      "1.3 Specifications",
      "Operating Voltage: 24VDC"
    ),
    attribute(
      "operating_temperature",
      "32°F to 120°F (0°C to 49°C)",
      "0–49",
      "°C",
      1,
      "1.3 Specifications",
      "Operating Temperature: 32°F to 120°F (0°C to 49°C)"
    ),
    attribute(
      "mounting_context",
      "compatible FACP cabinet; 5895XL or RPS-1000 intelligent power module cabinet; SK-NIC-KIT remote mounting kit; 5815RMK",
      "FACP cabinet; 5895XL; RPS-1000; SK-NIC-KIT; 5815RMK",
      null,
      1,
      "1.4 Mounting",
      "You can mount the 6815 in a compatible FACP cabinet, in the 5895XL or RPS-1000 intelligent power module cabinet, or in the SK-NIC-KIT remote mounting kit. If mounting the 6815 in a 5815RMK or SK-NIC-KIT...",
      96
    ),
    attribute(
      "device_addressing_method",
      "on-board DIP switches select an ID number",
      "DIP-switch selectable device ID",
      null,
      2,
      "1.6 Setting DIP Switches",
      "Use the on-board DIP switches to select an ID number for the 6815.",
      98
    ),
  ];

  return {
    source: {
      title: "6815 SLC Expander — Product Installation Document",
      publisher: "Honeywell",
      documentType: "Product Installation Document",
      documentNumber: "LS10173-001SK-E",
      revision: "A",
      publicationDate: "2017-07-01",
      checksum,
      byteSize,
      officialUrl: HONEYWELL_6815_INSTALLATION_URL,
      parserVersion: HONEYWELL_6815_INSTALLATION_PARSER_VERSION,
      sourceVersion: HONEYWELL_6815_INSTALLATION_SOURCE_VERSION,
      reviewStatus: "Needs Review",
    },

    products: [
      {
        code: "6815",
        description:
          "Honeywell 6815 SLC Expander for compatible Silent Knight and Farenhyt fire alarm control panels",
        proposedFamily: "Loop Card",
        attributes,
      },
    ],

    listingClaims: [],

    warnings: [
      "Family is proposed from the manufacturer's explicit SLC Expander product identity and remains subject to Product Library review.",
      "The reviewed installation document does not explicitly state 159 sensors/modules per loop; no such capacity attribute is created from this source.",
      "The reviewed installation document does not explicitly state that one 6815 adds exactly one SLC loop; added_slc_loops is therefore not created from this source.",
      "Panel compatibility is recorded only at the manufacturer-series level stated by the document; no individual compatible panel model is invented.",
    ],
  };
};
