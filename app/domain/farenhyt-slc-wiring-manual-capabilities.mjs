export const FARENHYT_SLC_WIRING_PARSER_VERSION =
  "farenhyt-slc-wiring-surge-1.0.0";
export const FARENHYT_SLC_WIRING_SOURCE_VERSION =
  "LS10179-000FH-E:B:4/17/2023";
export const FARENHYT_SLC_WIRING_SHA256 =
  "62fc67d711231bae170cc351904ea90fcecf2307deda0d0b608c389b630c1e2c";
export const FARENHYT_SLC_WIRING_URL =
  "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/wiring-manuals/LS10179-000FH-E-B.pdf";

// Honeywell / Farenhyt "SLC Wiring Manual", P/N LS10179-000FH-E, revision B,
// dated 4/17/2023 (84 pages).
//
// WHY THIS DOCUMENT EXISTS
//
// Al Mousa "28 46 00 Fire Detection and Alarm System - Rev 1", 1 GENERAL / I.3
// demands "Surge and Transient Protection: Isolation will be provided at field
// terminations to suppress voltage transients as needed."
//
// The canonical capability key `panel_transient_protection` was created for
// exactly that clause and was deliberately left with NO product value, because
// the IFP-2100 / IFP-2100ECS Installation and Operation Manual
// (LS10143-001SK-E, 233 pages) contains no surge or transient-protection
// statement at all. Section 1.6 of THIS document is the manufacturer's actual
// statement, and it is the only first-party statement located.
//
// SCOPE -- FAMILY-LEVEL, AND DELIBERATELY NOT SKU-SPECIFIC
//
// Section 1.6 names "IFP-2100/ECS, IFP-300/ECS, and IFP-75". It does NOT name
// IFP-2100HV, and the string "IFP-2100HV" occurs ZERO times in all 84 pages of
// this manual (measured, not assumed). The exact-model applicability of §1.6 to
// IFP-2100HV is therefore carried by the panel-family documentation, and is
// recorded here as an explicit, reviewable scope rationale rather than being
// quietly widened. Four independent first-party anchors support it:
//
//   1. THIS document's own section 1.1.1 "Reference Documentation" routes
//      "IFP-2100, IFP-2100ECS Control Panels" to instruction manual
//      LS10143-001SK-E -- the SAME manual whose page-12 NOTE places IFP-2100HV
//      inside the documented family.
//   2. LS10143-001SK-E:C page 12 NOTE: "All references to IFP-2100 or IFP-2100ECS
//      within this manual are applicable to the IFP-2100B and IFP-2100ECSB. All
//      References to the IFP-2100HV are applicable to the IFP-2100HVB,
//      RFP-2100HV, RFP-2100HVB, IFP-2100ECSHV and the IFP-2100ECSHVB."
//      Honeywell writes the family in one manual and one notation throughout.
//   3. LS10143-001SK-E:C section 4.2 and Table 3.1 show the HV variant differs
//      from the base model ONLY in the AC input rating ("120/240 VAC 4.5A for
//      the IFP-2100 / 2.8A for the IFP-2100HV"); the SLC terminations
//      ("S- SLC OUT / SC- SLC IN") and every 24 VDC Flexput circuit are the
//      same terminals in the same table. The FIELD WIRING that §1.6 protects is
//      therefore the same wiring on both variants.
//   4. Honeywell datasheet 351602 states "The IFP-2100, IFP-2100HV, RFP-2100,
//      and RFP-2100HV (red) and IFP-2100B, IFP-2100HVB, RFP-2100B, and
//      RFP-2100HVB (black)" as one series with one shared specification set.
//
// GRADE OF EVIDENCE: the surge-suppression STATEMENT is MANUFACTURER EVIDENCE,
// verbatim and page-cited. Its application to IFP-2100HV is ENGINEERING
// INFERENCE from those four anchors, and is labelled as such in the evidence
// every attribute below carries. It is not presented as a manufacturer
// statement about IFP-2100HV, because no such statement exists.
//
// IFP-2100ECS / IFP-2100ECSHV / IFP-2100ECSB / IFP-2100ECSHVB are deliberately
// NOT written by this parser. Their capability set is governed by a different
// datasheet (351600) and a different product scope, and this lane must not copy
// facts into an ECS SKU.
//
// Every entry is [capabilityKey, page, exactText]. `exactText` MUST be a
// verbatim span of this manual at the stated page.
const CAPABILITY_EVIDENCE = [
  [
    "panel_transient_protection",
    13,
    "The IFP-2100/ECS, IFP-300/ECS, and IFP-75 have built-in surge suppressors for all field wiring. No additional surge suppression is neces-sary.",
  ],
];

// The eight panel SKUs Honeywell's own 351602 datasheet and LS10143-001SK-E
// page-12 NOTE place inside the documented IFP-2100 family. This is exactly the
// SKU set the sibling capability attributes already use, so the panel family's
// governed knowledge stays on one scope.
const MODELS = [
  "IFP-2100",
  "IFP-2100HV",
  "IFP-2100B",
  "IFP-2100HVB",
  "RFP-2100",
  "RFP-2100HV",
  "RFP-2100B",
  "RFP-2100HVB",
];

export const extractFarenhytSlcWiringSurgeCapabilities = ({
  checksum,
  byteSize = null,
} = {}) => {
  // Same anti-misattribution guard as every registered parser: this parser may
  // only ever claim to have read the exact reviewed official manual.
  if (checksum !== FARENHYT_SLC_WIRING_SHA256) {
    throw Object.assign(
      new Error(
        "The PDF checksum does not match the reviewed official Farenhyt SLC Wiring Manual (Honeywell P/N LS10179-000FH-E rev B).",
      ),
      { code: "FARENHYT_SLC_WIRING_CHECKSUM_MISMATCH" },
    );
  }

  const products = MODELS.map((code) => ({
    code,
    description: `${code} Farenhyt Series analog addressable fire alarm control panel (surge / transient protection evidence only)`,
    attributes: CAPABILITY_EVIDENCE.map(([attributeName, page, exactText]) => ({
      attributeName,
      originalValue: "true",
      normalizedValue: "true",
      unit: null,
      page,
      section:
        "Section 1.6 Surge Suppression -- manufacturer statement names IFP-2100/ECS; applicability to this exact SKU rests on the documented IFP-2100 panel family (LS10143-001SK-E rev C page-12 NOTE, section 4.2 and Table 3.1, and datasheet 351602 single-series listing), recorded as ENGINEERING INFERENCE, not as a manufacturer statement about this SKU",
      exactText,
      confidence: 88,
      reviewStatus: "Needs Review",
    })),
  }));

  return {
    source: {
      title: "Farenhyt SLC Wiring Manual",
      publisher: "Honeywell Fire Systems",
      documentType: "Wiring Manual",
      documentNumber: "LS10179-000FH-E",
      revision: "B",
      publicationDate: "2023-04-17",
      releaseMark: "4/17/2023",
      checksum,
      byteSize,
      officialUrl: FARENHYT_SLC_WIRING_URL,
      parserVersion: FARENHYT_SLC_WIRING_PARSER_VERSION,
      sourceVersion: FARENHYT_SLC_WIRING_SOURCE_VERSION,
      reviewStatus: "Needs Review",
    },
    products,
    warnings: [
      "Scope is deliberately LIMITED to the single governed canonical capability the IFP-2100 / IFP-2100ECS Installation and Operation Manual (LS10143-001SK-E) does not state: panel_transient_protection. No electrical, capacity, physical, SLC-wiring or accessory fact is recorded here, so every other registered parser remains the single source of truth for those.",
      "EVIDENCE GRADE. The surge-suppression STATEMENT is manufacturer evidence, quoted verbatim from section 1.6 on page 13. Its application to IFP-2100HV is ENGINEERING INFERENCE from this manual's own section 1.1.1 reference table, from LS10143-001SK-E rev C page-12 NOTE and sections 4.2/Table 3.1, and from datasheet 351602 listing IFP-2100HV in the same series with one shared specification set. The string 'IFP-2100HV' does NOT occur anywhere in this 84-page manual, so this is not and must not be represented as a manufacturer statement about IFP-2100HV.",
      "This is PANEL-FAMILY-level evidence, not an exact-SKU claim, and it is persisted per SKU only inside the documented IFP-2100 family. It is never widened to the IFP-300, IFP-75 or IFP-2100ECS products named in the same sentence.",
      "IFP-2100ECS, IFP-2100ECSB, IFP-2100ECSHV and IFP-2100ECSHVB are deliberately NOT written by this parser. Nothing from this parser is copied to an ECS SKU; the ECS capability set is governed by datasheet 351600.",
      "'No additional surge suppression is necessary' is the manufacturer's own statement that NO EXTERNAL suppressor is required for field wiring. It is NOT evidence that the panel is listed for any particular surge withstand category, and must not be read as a UL 1449 or component-level suppression rating.",
    ],
  };
};