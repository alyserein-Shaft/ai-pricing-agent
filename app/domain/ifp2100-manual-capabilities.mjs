export const IFP2100_MANUAL_PARSER_VERSION = "ifp2100-manual-parser-1.0.0";
export const IFP2100_MANUAL_SOURCE_VERSION = "LS10143-001SK-E:C:12/18/2017";
export const IFP2100_MANUAL_SHA256 =
  "77634a119873cc1a13f1f3672764e90394e9b6cc7d2c237a19bcb0ad22abe69c";
export const IFP2100_MANUAL_URL =
  "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/moved-ss/IFP-2100-Manual.pdf";

// Honeywell / Farenhyt "IFP-2100 / IFP-2100ECS Manual", P/N LS10143-001SK-E,
// revision C, dated 12/18/2017 (233 pages).
//
// SCOPE -- deliberately narrow. This parser records ONLY the governed canonical
// CAPABILITY facts that the IFP-2100 datasheet (351602 rev C) does not state.
// Every electrical, capacity, physical and accessory fact for these SKUs already
// exists, SKU-scoped and provenance-bound, from the 351602 parser; duplicating or
// overriding them here would create two sources of truth for one product.
//
// EXACT-MODEL APPLICABILITY (the family-level rule that permits this document at
// all): the manual's own page footer reads "IFP-2100 / IFP-2100ECS Manual", so it
// explicitly governs the IFP-2100 model. Honeywell's 351602 datasheet establishes
// that IFP-2100HV is that same panel (it states the shared "FACPs have one
// built-in SLC", the shared 159/159 per-loop pools, and the shared red/black
// cabinet options for IFP-2100 and IFP-2100HV in one sentence), so the manual's
// capability statements transfer to IFP-2100HV on that explicit basis and not by
// assumption.
//
// The RFP-2100 variants are deliberately EXCLUDED from the display capability:
// 351602 states "The RFP-2100(HV)(B) performs the same functions as the
// IFP-2100(HV)(B) but does not include a display", so the RFPs are recorded as
// NOT having the local display while every other capability is identical.
//
// Every entry is [capabilityKey, page, exactText]. `exactText` MUST be a verbatim
// span of the manual at the stated page: it is what makes the promoted capability
// auditable back to the page a reviewer can open.
const CAPABILITY_EVIDENCE = [
  ["peer_to_peer_network", 12, "The network architecture provides true peer to peer capability allowing network survivability for all hardware that remains operational in the event of partial system failure."],
  ["operator_event_logging", 110, "F1 Key Active F2 Key Active F3 Key Active F4 Key Active"],
  ["alarm_verification_support", 130, "Alarm verification is an optional false alarm prevention feature that verifies an alarm condition by resetting the smoke detector. If the alarm condition still exists by the time the reset cycle has completed, the detector will go into alarm. If the detector is no longer in alarm, no report will go to the central station."],
  ["signal_reactivation_control", 133, "Auto Unsilence If this option is selected, the output group can be silenced for a programmed time-frame. If the condition that caused the output to activate has not cleared during the time-frame, the output reactivates."],
  ["panel_online_diagnostics", 195, "The fire control panel has several built-in testing and troubleshooting tools that can be utilized to save time while testing and troubleshooting points and SLC devices."],
  ["panel_communication_ports", 12, "The system can have a maximum of 63 SBUS devices in any combination."],
  ["panel_database_support", 12, "Non-volatile event history stores 1000 events per panel"],
  ["panel_software_integration", 15, "HFSS Honeywell Fire For communication and panel programming with a Windows-based"],
  // The display split is per-model, not shared, so it is recorded below rather
  // than in this table. See DISPLAY_CAPABILITY.
];

// The MANUAL states the display split itself, on page 12: "The RFP-2100 (red) or
// RFP-2100B (black) are the same as the IFP-2100 WITHOUT THE DISPLAY." That single
// sentence establishes both sides -- the IFP-2100 HAS a display, the RFP-2100 does
// not -- so this is an explicit documented fact per SKU, not an inference from the
// absence of a negated statement. It is deliberately NOT in the shared table: a
// shared "true" would emit a contradictory true/false pair for the RFP variants.
const DISPLAY_PRESENT_TEXT = "The RFP-2100 (red) or RFP-2100B (black) are the same as the IFP-2100 without the display.";
const DISPLAY_ABSENT_TEXT_351602 =
  "The RFP-2100(HV)(B) performs the same functions as the IFP-2100(HV)(B) but does not include a display.";

// Additional verbatim support recorded as governed ATTRIBUTES (not capabilities)
// because they are the manufacturer's own concrete limits on the capabilities
// above, and a reviewer must be able to see them without opening a second source.
const SUPPORTING_ATTRIBUTES = [
  ["alarm_verification_confirmation_time", "60 to 250 seconds (default 60 seconds)", "60-250", "seconds", 148, "Alarm Verify", "You can set the alarm verification time from 60 to 250 seconds (default is 60 seconds)."],
  ["event_history_capacity", "1000 events per panel", "1000", "events", 12, "Software Features", "Non-volatile event history stores 1000 events per panel"],
  ["event_history_event_types", "F1 Key Active; F2 Key Active; F3 Key Active; F4 Key Active", "F1-F4 Key Active", null, 110, "Table 8-1 Event Types", "F1 Key Active F2 Key Active F3 Key Active F4 Key Active"],
  ["max_sbus_devices", "maximum of 63 SBUS devices in any combination", "63", "devices", 12, "Network Features", "The system can have a maximum of 63 SBUS devices in any combination."],
];

const MODELS = [
  { code: "IFP-2100", display: true },
  { code: "IFP-2100HV", display: true },
  { code: "IFP-2100B", display: true },
  { code: "IFP-2100HVB", display: true },
  { code: "RFP-2100", display: false },
  { code: "RFP-2100HV", display: false },
  { code: "RFP-2100B", display: false },
  { code: "RFP-2100HVB", display: false },
];

export const extractIfp2100ManualCapabilities = ({ checksum, byteSize = null } = {}) => {
  // Same anti-misattribution guard as every registered parser: this parser may
  // only ever claim to have read the exact reviewed official manual.
  if (checksum !== IFP2100_MANUAL_SHA256) {
    throw Object.assign(
      new Error("The PDF checksum does not match the reviewed official IFP-2100 Installation and Operation Manual (Honeywell P/N LS10143-001SK-E rev C)."),
      { code: "IFP2100_MANUAL_CHECKSUM_MISMATCH" },
    );
  }

  const products = MODELS.map((model) => {
    const attributes = CAPABILITY_EVIDENCE.map(([capabilityKey, page, exactText]) => ({
      attributeName: capabilityKey,
      originalValue: "true",
      normalizedValue: "true",
      unit: null,
      page,
      section: "Capabilities",
      exactText,
      confidence: 97,
      reviewStatus: "Needs Review",
    }));
    // Recorded for EVERY model, as an explicit true/false rather than omitted: an
    // absent capability and an explicitly-absent capability are different
    // governed states, and only the explicit false can ever support a panel that
    // legitimately has no local display.
    attributes.push({
      attributeName: "local_operator_display",
      originalValue: String(model.display),
      normalizedValue: String(model.display),
      unit: null,
      page: 12,
      section: model.display ? "Introduction -- RFP-2100 defined as the IFP-2100 without the display" : "Introduction -- RFP-2100 display split",
      exactText: model.display ? DISPLAY_PRESENT_TEXT : DISPLAY_ABSENT_TEXT_351602,
      confidence: 97,
      reviewStatus: "Needs Review",
    });
    for (const [attributeName, originalValue, normalizedValue, unit, page, section, exactText] of SUPPORTING_ATTRIBUTES) {
      attributes.push({ attributeName, originalValue, normalizedValue, unit, page, section, exactText, confidence: 96, reviewStatus: "Needs Review" });
    }
    return { code: model.code, description: `${model.code} Farenhyt Series analog addressable fire alarm control panel (capability evidence only)`, attributes };
  });

  return {
    source: {
      title: "IFP-2100 / IFP-2100ECS Installation and Operation Manual",
      publisher: "Honeywell Fire Solutions",
      documentType: "Installation and Operation Manual",
      documentNumber: "LS10143-001SK-E",
      revision: "C",
      publicationDate: "2017-12-18",
      releaseMark: "12/18/2017",
      checksum,
      byteSize,
      officialUrl: IFP2100_MANUAL_URL,
      parserVersion: IFP2100_MANUAL_PARSER_VERSION,
      sourceVersion: IFP2100_MANUAL_SOURCE_VERSION,
      reviewStatus: "Needs Review",
    },
    products,
    warnings: [
      "Scope is deliberately LIMITED to the governed canonical capability facts the IFP-2100 datasheet (351602 rev C) does not state. No electrical, capacity, physical or accessory fact is recorded here, so the 351602 parser remains the single source of truth for those.",
      "The manual governs the IFP-2100 / IFP-2100ECS model. Its capability statements transfer to IFP-2100HV / IFP-2100B / IFP-2100HVB on Honeywell's own explicit 351602 statement that IFP-2100 and IFP-2100HV are one panel, not on assumption.",
      "IFP-2100ECS is NOT recorded: its capability set is broader (Emergency Communication System) and is governed by a different datasheet. Nothing from this parser is copied to an ECS SKU.",
      "panel_transient_protection has NO evidence in this manual and therefore NO capability attribute. It is recorded as absent on purpose: an absent capability must resolve to Insufficient Evidence, never be implied true or implied false.",
      "alarm_verification_support is documented as an OPTIONAL, per-zone programmable feature (60-250 second confirmation period; not usable with two-count zones). It is recorded as supported; the conditionality is carried by the requirement side, not hidden here.",
      "peer_to_peer_network is evidenced for the SK-NIC networked architecture; a candidate with no SK-NIC network card fitted would need its own review.",
    ],
  };
};