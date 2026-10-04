import {
  extractIfp75Datasheet,
  IFP75_DATASHEET_PARSER_VERSION,
  IFP75_DATASHEET_SHA256,
  IFP75_DATASHEET_SOURCE_VERSION,
} from "./ifp75-datasheet.mjs";

import {
  extractHoneywell6815InstallationDocument,
  HONEYWELL_6815_INSTALLATION_PARSER_VERSION,
  HONEYWELL_6815_INSTALLATION_SHA256,
  HONEYWELL_6815_INSTALLATION_SOURCE_VERSION,
} from "./6815-installation-document.mjs";

import {
  extractIfp2100ManualCapabilities,
  IFP2100_MANUAL_PARSER_VERSION,
  IFP2100_MANUAL_SHA256,
  IFP2100_MANUAL_SOURCE_VERSION,
} from "./ifp2100-manual-capabilities.mjs";

import {
  extractIfp2100Datasheet,
  IFP2100_DATASHEET_PARSER_VERSION,
  IFP2100_DATASHEET_SHA256,
  IFP2100_DATASHEET_SOURCE_VERSION,
} from "./ifp2100-datasheet.mjs";

import {
  extractFarenhytSlcWiringSurgeCapabilities,
  FARENHYT_SLC_WIRING_PARSER_VERSION,
  FARENHYT_SLC_WIRING_SHA256,
  FARENHYT_SLC_WIRING_SOURCE_VERSION,
} from "./farenhyt-slc-wiring-manual-capabilities.mjs";

const freeze = (value) => Object.freeze(value);

const PARSERS = freeze([
  freeze({
    id: "honeywell-farenhyt-ifp75",
    manufacturer: "Honeywell",
    brand: "Farenhyt",
    checksum: IFP75_DATASHEET_SHA256,
    parserVersion: IFP75_DATASHEET_PARSER_VERSION,
    sourceVersion: IFP75_DATASHEET_SOURCE_VERSION,
    extract: extractIfp75Datasheet,
    persistence: freeze({
      handler: "IFP75",
      sourceType: "Product Datasheet",
      authority: "Official Manufacturer",
      documentType: "Product Datasheet",
      sourceReliability: "Authoritative Manufacturer Source",
      pages: [1, 2, 3, 4],
      evidenceText: "The IFP-75 and IFP-75HV (red) and the IFP-75B and IFP-75HVB (black)",
      idempotencyPrefix: "ifp75-datasheet",
      processingMessage: "Official IFP-75 datasheet extracted; all attributes and listing claims await review.",
    }),
  }),
  freeze({
    id: "honeywell-farenhyt-6815",
    manufacturer: "Honeywell",
    brand: "Farenhyt",
    checksum: HONEYWELL_6815_INSTALLATION_SHA256,
    parserVersion: HONEYWELL_6815_INSTALLATION_PARSER_VERSION,
    sourceVersion: HONEYWELL_6815_INSTALLATION_SOURCE_VERSION,
    extract: extractHoneywell6815InstallationDocument,
    persistence: freeze({
      handler: "HONEYWELL_6815",
      sourceType: "Product Datasheet",
      authority: "Official Manufacturer",
      documentType: "Product Installation Document",
      sourceReliability: "Authoritative Manufacturer Source",
      pages: [1, 2],
      evidenceText: "6815 SLC Expander",
      idempotencyPrefix: "honeywell-6815-installation",
      processingMessage: "Official Honeywell 6815 installation document extracted; all product facts await review.",
    }),
  }),
  freeze({
    id: "honeywell-farenhyt-ifp2100",
    manufacturer: "Honeywell",
    brand: "Farenhyt",
    checksum: IFP2100_DATASHEET_SHA256,
    parserVersion: IFP2100_DATASHEET_PARSER_VERSION,
    sourceVersion: IFP2100_DATASHEET_SOURCE_VERSION,
    extract: extractIfp2100Datasheet,
    persistence: freeze({
      handler: "IFP2100",
      sourceType: "Product Datasheet",
      authority: "Official Manufacturer",
      documentType: "Product Datasheet",
      sourceReliability: "Authoritative Manufacturer Source",
      pages: [1, 2, 3, 4],
      evidenceText:
        "The IFP-2100, IFP-2100HV, RFP-2100, and RFP-2100HV (red) and IFP-2100B, IFP-2100HVB, RFP-2100B, and RFP-2100HVB (black)",
      idempotencyPrefix: "ifp2100-datasheet",
      processingMessage:
        "Official IFP-2100/RFP-2100 datasheet extracted; all attributes, listing claims and standards await review.",
    }),
  }),
  freeze({
    id: "honeywell-farenhyt-ifp2100-manual",
    manufacturer: "Honeywell",
    brand: "Farenhyt",
    checksum: IFP2100_MANUAL_SHA256,
    parserVersion: IFP2100_MANUAL_PARSER_VERSION,
    sourceVersion: IFP2100_MANUAL_SOURCE_VERSION,
    extract: extractIfp2100ManualCapabilities,
    persistence: freeze({
      handler: "IFP2100MANUAL",
      sourceType: "Installation and Operation Manual",
      authority: "Official Manufacturer",
      documentType: "Installation and Operation Manual",
      sourceReliability: "Authoritative Manufacturer Source",
      pages: [1, 12, 13, 15, 110, 130, 133, 148, 195],
      evidenceText:
        "IFP-2100 / IFP-2100ECS Manual - P/N LS10143-001SK-E:C 12/18/2017",
      idempotencyPrefix: "ifp2100-manual-capabilities",
      processingMessage:
        "Official IFP-2100 Installation and Operation Manual extracted; capability evidence awaits review.",
    }),
  }),
  freeze({
    id: "honeywell-farenhyt-slc-wiring",
    manufacturer: "Honeywell",
    brand: "Farenhyt",
    checksum: FARENHYT_SLC_WIRING_SHA256,
    parserVersion: FARENHYT_SLC_WIRING_PARSER_VERSION,
    sourceVersion: FARENHYT_SLC_WIRING_SOURCE_VERSION,
    extract: extractFarenhytSlcWiringSurgeCapabilities,
    persistence: freeze({
      handler: "FARENHYT_SLC_WIRING",
      sourceType: "Product Manual",
      authority: "Official Manufacturer",
      documentType: "Product Installation Document",
      sourceReliability: "Authoritative Manufacturer Source",
      pages: [13],
      evidenceText: "The IFP-2100/ECS, IFP-300/ECS, and IFP-75 have built-in surge suppressors for all field wiring.",
      idempotencyPrefix: "farenhyt-slc-wiring-surge",
      processingMessage:
        "Official Farenhyt SLC Wiring Manual extracted; surge / transient protection evidence awaits review.",
    }),
  }),
]);

// Deliberately omits each parser's executable `extract` function: the read
// model exposes declarative metadata only, so no caller can obtain a parser
// through this surface and bypass the reviewed-checksum resolution below.
export const registeredProductDatasheetParsers = () =>
  PARSERS.map((parser) => {
    const metadata = { ...parser };
    delete metadata.extract;
    return metadata;
  });

export const resolveProductDatasheetParser = ({ checksum } = {}) => {
  const normalizedChecksum = String(checksum || "").trim().toLowerCase();
  if (!normalizedChecksum) return null;

  return (
    PARSERS.find(
      (parser) => parser.checksum.toLowerCase() === normalizedChecksum
    ) || null
  );
};
