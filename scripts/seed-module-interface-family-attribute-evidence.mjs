#!/usr/bin/env node
/**
 * Sprint 1.34 -- brings the Honeywell/Farenhyt Monitor Module, Control
 * Module, Relay Module, Zone Module, Isolator Module, and Output Module
 * (combined Monitor/Relay) families from CLASSIFIED_BUT_SHALLOW to reusable
 * technical readiness using twelve official Honeywell/Farenhyt documents,
 * each applied only to the exact SKU it names.
 *
 * Every module in this catalog (except EOLR-1, WIDP-MONITOR, WIDP-RELAY)
 * shares the same 7-panel Farenhyt compatibility list (IFP-2100/IFP-2100ECS/
 * RFP-2100, IFP-2000/IFP-2000ECS/RPS-2000, IFP-1000/IFP-1000ECS,
 * IFP-300/IFP-300ECS, IFP-100/IFP-100ECS, IFP-75, IFP-50) -- each product's
 * own "Compatibility" section states this explicitly, never inferred from
 * one product to another.
 *
 * DOC_MONITOR      IDP-MONITOR (Doc 350288, Rev K, 11/17)
 * DOC_MINIMON      IDP-MINIMON (Doc 350279, Rev H, 08/17)
 * DOC_MONITOR_2    IDP-MONITOR-2 (Doc 350289, Rev G, 11/17)
 * DOC_MONITOR_10   IDP-MONITOR-10 (Doc 350296, Rev G, 09/17)
 * DOC_WIDP_MON_REL WIDP-MONITOR & WIDP-RELAY (Doc 350617, Rev B, 10/18)
 * DOC_CONTROL      IDP-CONTROL (Doc 350293, Rev H, 09/17)
 * DOC_CONTROL_6    IDP-CONTROL-6 (Doc 350294, Rev J, 09/17)
 * DOC_RELAY        IDP-RELAY (Doc 350290, Rev K, 12/17)
 * DOC_RELAY_6      IDP-RELAY-6 (Doc 350291, Rev G, 12/17)
 * DOC_RELAYMON_2   IDP-RELAYMON-2 (Doc 350366, Rev E, 09/17)
 * DOC_ZONE         IDP-ZONE (Doc 350292, Rev H, 09/17)
 * DOC_ISO          IDP-ISO (Doc 350287, Rev J, 08/17)
 * DOC_ISO_6        ISO-6 (P/N 350997, Rev A, 2015) -- its OWN compatible-
 *   panel list is genuinely different (IFP-2000/RPS-2000, IFP-2000ECS,
 *   IFP-1000/ECS, IFP-100/ECS, IFP-50, IFP-25) from every other module's
 *   7-panel list -- kept distinct, not collapsed into the common list.
 *
 * Kept genuinely distinct per the task:
 * - Monitor (input-only, supervised contact interface) vs Control (NAC
 *   output switching) vs Relay (Form C dry-contact switching, unsupervised)
 *   vs Zone (2-wire conventional-loop-to-SLC interface) vs Isolator (SLC
 *   fault isolation, no I/O function of its own) are never merged.
 * - IDP-RELAYMON-2 is explicitly tagged module_type="Combined Monitor/Relay
 *   Module" (2 monitor inputs + 2 relay outputs) rather than treated as a
 *   plain Relay or Monitor module -- its own family (Output Module) is left
 *   as-is since the classifier confidently returns that for its own text,
 *   but the attribute makes its combined nature explicit and queryable.
 * - EOLR-1 ("12 or 24 volt EOL relay module") is a passive, non-addressable
 *   end-of-line terminating relay named as an accessory in IDP-CONTROL's own
 *   wiring diagram ("TO NEXT CONTROL MODULE OR END-OF-LINE RELAY. ONE RELAY
 *   IS REQUIRED FOR EACH CIRCUIT") -- genuinely different from the
 *   addressable Form-C relay modules (IDP-RELAY/IDP-RELAY-6/WIDP-RELAY), so
 *   it keeps its own module_type and gets NO protocol/compatible-panel facts
 *   (it has no SLC address of its own).
 * - WIDP-MONITOR/WIDP-RELAY's compatible-panel list (6 panels) and standards
 *   are their OWN, narrower list -- not copied from the wired 7-panel list.
 *   Their FACP connection is indirect, through the WIDP-WGI gateway using
 *   IDP protocol on the SLC loop (same principle already established for
 *   WIDP-HEAT in Sprint 1.30) -- no direct protocol/compatible_panel_families
 *   fact is asserted on the modules themselves, only compatible_control_panels_via_gateway.
 *
 * Real, pre-existing data defects fixed as part of this same governed pass:
 * - IDP-RELAY carried a garbled standards entry {"body":"ISO","number":
 *   "lated","originalText":"Isolated"} -- a parsing accident splitting the
 *   word "Isolated" the same way B224BI's "Isolator" was split in Sprint
 *   1.33. Removed, not reinterpreted.
 * - WIDP-MONITOR and WIDP-RELAY each carried a garbled attribute
 *   {"name":"Current","originalValue":"123A"} -- clearly mis-parsed from the
 *   "(4) CR-123A batteries" text in their own description, not a real 123
 *   Amp current rating (no module in this catalog draws anywhere near that).
 *   Removed. The same "123A" artifact was found on 8 other catalog products
 *   in unrelated families (WIDP-HEAT, WIDP-PHOTO, WAV-CRL, W-SYNC, etc.) --
 *   reported as an out-of-scope systemic gap, not fixed here.
 *
 * Usage:
 *   node scripts/seed-module-interface-family-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-module-interface-family-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-module-interface-family-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const doc = (sourceId, url) => ({ sourceType: "Manufacturer Official Datasheet", sourceId, url });
const DOC_MONITOR = doc("Honeywell Farenhyt \"IDP-MONITOR: Addressable Monitor Module\" (Doc 350288, Rev K, 11/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-MONITOR-Datasheet.pdf");
const DOC_MINIMON = doc("Honeywell Farenhyt \"IDP-MINIMON: Addressable Monitor Module\" (Doc 350279, Rev H, 08/17)", "https://esis-egy.com/wp-content/uploads/2022/07/IDPMINIMON_Datasheet.pdf");
const DOC_MONITOR_2 = doc("Honeywell Farenhyt \"IDP-MONITOR-2: Addressable Dual Monitor Module\" (Doc 350289, Rev G, 11/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/350289-G-IDP-Monitor-2.pdf");
const DOC_MONITOR_10 = doc("Honeywell Farenhyt \"IDP-Monitor-10: Addressable Monitor Module\" (Doc 350296, Rev G, 09/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_Monitor_10_Datasheet.pdf");
const DOC_WIDP_MON_REL = doc("Honeywell Farenhyt \"WIDP-MONITOR & WIDP-RELAY: SWIFT Wireless Modules\" (Doc 350617, Rev B, 10/18)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-350617-B.pdf");
const DOC_CONTROL = doc("Honeywell Farenhyt \"IDP-Control: Addressable Notification Module\" (Doc 350293, Rev H, 09/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_Control_Datasheet.pdf");
const DOC_CONTROL_6 = doc("Honeywell Farenhyt \"IDP-Control-6: Addressable Notification Module\" (Doc 350294, Rev J, 09/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_Control_6_Datasheet.pdf");
const DOC_RELAY = doc("Honeywell Farenhyt \"IDP-RELAY: Addressable Relay Module\" (Doc 350290, Rev K, 12/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-RELAY-Datasheet.pdf");
const DOC_RELAY_6 = doc("Honeywell Farenhyt \"IDP-RELAY-6: Addressable Relay Module\" (Doc 350291, Rev G, 12/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/350291-G-IDP-Relay-6.pdf");
const DOC_RELAYMON_2 = doc("Honeywell Farenhyt \"IDP-RELAYMON-2: Addressable Dual Relay/Monitor Module\" (Doc 350366, Rev E, 09/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_RELAYMON_2_Datasheet.pdf");
const DOC_ZONE = doc("Honeywell Farenhyt \"IDP-Zone: Addressable Two-Wire Interface Module\" (Doc 350292, Rev H, 09/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_Zone_Datasheet.pdf");
const DOC_ISO = doc("Honeywell Farenhyt \"IDP-ISO: Line Isolator Module\" (Doc 350287, Rev J, 08/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_ISO_Datasheet.pdf");
const DOC_ISO_6 = doc("Honeywell Silent Knight/Farenhyt \"ISO-6: Six Fault Isolator Module\" (P/N 350997, Rev A, 2015)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Farenhyt-120425/hon-ba-fire-350997-iso-6.pdf");

const fact = (name, value, { operator = "Equal", page = 1, section, srcDoc, confidence = 90, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url, page, section },
});

const STANDARD_7_PANELS = "IFP-2100, IFP-2100ECS, RFP-2100, IFP-2000, IFP-2000ECS, RPS-2000, IFP-1000, IFP-1000ECS, IFP-300, IFP-300ECS, IFP-100, IFP-100ECS, IFP-75, IFP-50";
const compatPanels = (srcDoc, page = 1) => fact("compatible_panel_families", STANDARD_7_PANELS, { operator: "Informational", srcDoc, page, section: "Compatibility" });
const voltage1532 = (srcDoc, page = 2) => fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc, page, section: "Electrical Ratings" });

const PRODUCT_ATTRIBUTES = {
  "IDP-MONITOR": [
    fact("module_type", "Monitor Module", { srcDoc: DOC_MONITOR, section: "Product Description" }),
    fact("device_role", "Single Contact Monitor", { srcDoc: DOC_MONITOR, section: "Product Description" }),
    fact("supervised_input_capability", "Class A or Class B supervised, single contact", { srcDoc: DOC_MONITOR, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_MONITOR, section: "Product Description" }),
    compatPanels(DOC_MONITOR),
    voltage1532(DOC_MONITOR),
    fact("mounting_requirement", "4in square electrical box, min 2-1/8in depth", { operator: "Informational", srcDoc: DOC_MONITOR, page: 1, section: "Installation" }),
  ],
  "IDP-MINIMON": [
    fact("module_type", "Monitor Module", { srcDoc: DOC_MINIMON, section: "Product Description" }),
    fact("device_role", "Single Contact Monitor (Compact)", { srcDoc: DOC_MINIMON, section: "Product Description" }),
    fact("supervised_input_capability", "Class B supervised only, single contact", { srcDoc: DOC_MINIMON, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_MINIMON, section: "Product Description" }),
    compatPanels(DOC_MINIMON),
    voltage1532(DOC_MINIMON),
    fact("mounting_requirement", "Single-gang junction box directly behind monitored device; no SMB500 backbox needed", { operator: "Informational", srcDoc: DOC_MINIMON, page: 1, section: "Installation" }),
  ],
  "IDP-MONITOR-2": [
    fact("module_type", "Monitor Module", { srcDoc: DOC_MONITOR_2, section: "Product Description" }),
    fact("device_role", "Dual Contact Monitor (2 Independent Circuits)", { srcDoc: DOC_MONITOR_2, section: "Product Description" }),
    fact("supervised_input_capability", "Class B supervised, 2 independently addressed circuits", { srcDoc: DOC_MONITOR_2, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_MONITOR_2, section: "Product Description" }),
    compatPanels(DOC_MONITOR_2),
    voltage1532(DOC_MONITOR_2),
    fact("mounting_requirement", "4in square electrical box, min 2-1/8in depth", { operator: "Informational", srcDoc: DOC_MONITOR_2, page: 1, section: "Installation" }),
  ],
  "IDP-MONITOR-10": [
    fact("module_type", "Monitor Module", { srcDoc: DOC_MONITOR_10, section: "Product Description" }),
    fact("device_role", "10-Point Monitor (Multi-Module Board)", { srcDoc: DOC_MONITOR_10, section: "Product Description" }),
    fact("supervised_input_capability", "10 Class B supervised inputs, or 5 Class A supervised inputs", { srcDoc: DOC_MONITOR_10, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_MONITOR_10, section: "Product Description" }),
    compatPanels(DOC_MONITOR_10),
    voltage1532(DOC_MONITOR_10),
    fact("mounting_requirement", "Up to two modules per IDP-ACB accessory cabinet", { operator: "Informational", srcDoc: DOC_MONITOR_10, page: 1, section: "Installation" }),
  ],
  "WIDP-MONITOR": [
    fact("module_type", "Monitor Module", { srcDoc: DOC_WIDP_MON_REL, section: "Product Description" }),
    fact("device_role", "Wireless Single Contact Monitor (SWIFT Mesh)", { srcDoc: DOC_WIDP_MON_REL, section: "Product Description" }),
    fact("supervised_input_capability", "Non-latching contact input, no reset required", { srcDoc: DOC_WIDP_MON_REL, page: 1, section: "Product Description" }),
    fact("compatible_control_panels_via_gateway", "IFP-75, IFP-300, IFP-300ECS, IFP-2100, IFP-2100ECS, RFP-2100 (indirect, via WIDP-WGI SWIFT Gateway using IDP protocol on the SLC loop -- not a direct SLC connection)", { operator: "Informational", srcDoc: DOC_WIDP_MON_REL, page: 2, section: "Compatible Control Panels" }),
    fact("mounting_requirement", "Recommended in SMB500(-WH) box rather than a metal backbox for best RF performance; requires (4) CR-123A batteries", { operator: "Informational", srcDoc: DOC_WIDP_MON_REL, page: 2, section: "SWIFT Components and Ordering Information" }),
  ],
  "IDP-CONTROL": [
    fact("module_type", "Control Module", { srcDoc: DOC_CONTROL, section: "Product Description" }),
    fact("device_role", "Single-Circuit NAC Control Module", { srcDoc: DOC_CONTROL, section: "Product Description" }),
    fact("nac_control_output_capability", "Supervised Class A or Class B NAC monitoring; disconnects supervision and connects external power supply to the load device on FACP command; power supply always relay-isolated from the SLC loop", { srcDoc: DOC_CONTROL, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_CONTROL, section: "Product Description" }),
    compatPanels(DOC_CONTROL),
    voltage1532(DOC_CONTROL),
    fact("mounting_requirement", "4in square electrical box, min 2-1/8in depth", { operator: "Informational", srcDoc: DOC_CONTROL, page: 1, section: "Installation" }),
  ],
  "IDP-CONTROL-6": [
    fact("module_type", "Control Module", { srcDoc: DOC_CONTROL_6, section: "Product Description" }),
    fact("device_role", "6-Circuit NAC Control Module (Multi-Module Board)", { srcDoc: DOC_CONTROL_6, section: "Product Description" }),
    fact("nac_control_output_capability", "Six independent supervised Class A/B NAC circuits, each with short-circuit protection monitoring and fault-finding algorithm; up to 3 unused modules can be disabled", { srcDoc: DOC_CONTROL_6, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_CONTROL_6, section: "Product Description" }),
    compatPanels(DOC_CONTROL_6),
    voltage1532(DOC_CONTROL_6),
    fact("mounting_requirement", "Mounts in IDP-ACB cabinet (accommodates one or two IDP-CONTROL-6 boards)", { operator: "Informational", srcDoc: DOC_CONTROL_6, page: 1, section: "Installation" }),
  ],
  "IDP-RELAY": [
    fact("module_type", "Relay Module", { srcDoc: DOC_RELAY, section: "Product Description" }),
    fact("device_role", "Dual Form-C Relay (Addressable)", { srcDoc: DOC_RELAY, section: "Product Description" }),
    fact("relay_contact_ratings", "2.0A@25VAC(PF=.35) non-coded; 3.0A@30VDC resistive non-coded; 2.0A@30VDC resistive coded; 0.46A@30VDC(L/R=20ms); 0.7A@70.7VAC(PF=.35); 0.9A@125VDC resistive; 0.5A@125VAC(PF=.75); 0.3A@125VAC(PF=.35)", { operator: "Informational", srcDoc: DOC_RELAY, page: 2, section: "Electrical Ratings" }),
    fact("dry_contact_capability", "Two isolated sets of Form C contacts (DPDT); no NAC wiring supervision provided", { srcDoc: DOC_RELAY, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_RELAY, section: "Product Description" }),
    compatPanels(DOC_RELAY),
    voltage1532(DOC_RELAY),
    fact("mounting_requirement", "4in square electrical box, min 2-1/8in depth", { operator: "Informational", srcDoc: DOC_RELAY, page: 1, section: "Installation" }),
  ],
  "IDP-RELAY-6": [
    fact("module_type", "Relay Module", { srcDoc: DOC_RELAY_6, section: "Product Description" }),
    fact("device_role", "Six Form-C Relay Board (Addressable)", { srcDoc: DOC_RELAY_6, section: "Product Description" }),
    fact("relay_contact_ratings", "2.0A@25VAC(PF=.35) non-coded; 3.0A@30VDC resistive non-coded; 2.0A@30VDC resistive coded; 0.46A@30VDC(L/R=20ms); 0.7A@70.7VAC(PF=.35); 0.9A@125VDC resistive; 0.5A@125VAC(PF=.75); 0.3A@125VAC(PF=.35)", { operator: "Informational", srcDoc: DOC_RELAY_6, page: 2, section: "Electrical Ratings" }),
    fact("dry_contact_capability", "Six Form C contacts; up to 3 unused modules can be disabled; no NAC wiring supervision provided", { srcDoc: DOC_RELAY_6, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_RELAY_6, section: "Product Description" }),
    compatPanels(DOC_RELAY_6),
    voltage1532(DOC_RELAY_6),
    fact("mounting_requirement", "Mounts in IDP-ACB cabinet (accommodates one or two IDP-RELAY-6 boards)", { operator: "Informational", srcDoc: DOC_RELAY_6, page: 1, section: "Installation" }),
  ],
  "WIDP-RELAY": [
    fact("module_type", "Relay Module", { srcDoc: DOC_WIDP_MON_REL, section: "Product Description" }),
    fact("device_role", "Wireless Single Form-C Relay (SWIFT Mesh)", { srcDoc: DOC_WIDP_MON_REL, section: "Product Description" }),
    fact("relay_contact_ratings", "2.0A@25VAC(PF=.35) non-coded; 3.0A@30VDC resistive non-coded; 2.0A@30VDC resistive coded; 0.46A@30VDC(L/R=20ms); 0.7A@70.7VAC(PF=.35); 0.9A@125VDC resistive; 0.5A@125VAC(PF=.75); 0.3A@125VAC(PF=.35)", { operator: "Informational", srcDoc: DOC_WIDP_MON_REL, page: 3, section: "Relay Contact Ratings" }),
    fact("dry_contact_capability", "One isolated set of Form C contacts (SPDT); circuit connections not supervised by the module", { srcDoc: DOC_WIDP_MON_REL, page: 1, section: "Product Description" }),
    fact("compatible_control_panels_via_gateway", "IFP-75, IFP-300, IFP-300ECS, IFP-2100, IFP-2100ECS, RFP-2100 (indirect, via WIDP-WGI SWIFT Gateway using IDP protocol on the SLC loop -- not a direct SLC connection)", { operator: "Informational", srcDoc: DOC_WIDP_MON_REL, page: 2, section: "Compatible Control Panels" }),
    fact("mounting_requirement", "Recommended in SMB500(-WH) box rather than a metal backbox for best RF performance; requires (4) CR-123A batteries", { operator: "Informational", srcDoc: DOC_WIDP_MON_REL, page: 2, section: "SWIFT Components and Ordering Information" }),
  ],
  "EOLR-1": [
    fact("module_type", "End-of-Line Terminating Relay (Passive, Non-Addressable)", { srcDoc: DOC_CONTROL, page: 2, section: "Notification Appliance Circuit Wiring Diagram", sourceText: "TO NEXT CONTROL MODULE OR END-OF-LINE RELAY. ONE RELAY IS REQUIRED FOR EACH CIRCUIT." }),
    fact("device_role", "NAC Circuit End-of-Line Termination (required one per IDP-CONTROL/IDP-CONTROL-6 circuit not daisy-chained to another control module)", { srcDoc: DOC_CONTROL, page: 2, section: "Notification Appliance Circuit Wiring Diagram" }),
  ],
  "IDP-RELAYMON-2": [
    fact("module_type", "Combined Monitor/Relay Module (Dual Input / Dual Output)", { srcDoc: DOC_RELAYMON_2, section: "Product Description" }),
    fact("device_role", "2 Class B Monitor Inputs + 2 Form-C Relay Outputs, independently addressed", { srcDoc: DOC_RELAYMON_2, section: "Product Description" }),
    fact("supervised_input_capability", "Class B supervised, 2 independent monitor inputs", { srcDoc: DOC_RELAYMON_2, section: "Product Description" }),
    fact("relay_contact_ratings", "2A@25VAC(PF=0.35) non-coded; 3A@30VDC resistive non-coded; 2A@30VDC resistive coded; 0.46A@30VDC(L/R=20ms); 0.7A@70.7VAC(PF=0.35); 0.9A@125VDC resistive; 0.5A@125VAC(PF=0.75); 0.3A@120VAC(PF=0.35)", { operator: "Informational", srcDoc: DOC_RELAYMON_2, page: 2, section: "Relay Contact Ratings" }),
    fact("dry_contact_capability", "2 Form C relay outputs, each independently addressed, not wiring-supervised", { srcDoc: DOC_RELAYMON_2, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_RELAYMON_2, section: "Product Description" }),
    compatPanels(DOC_RELAYMON_2),
    voltage1532(DOC_RELAYMON_2),
    fact("mounting_requirement", "4in square electrical box, min 2-1/8in depth", { operator: "Informational", srcDoc: DOC_RELAYMON_2, page: 1, section: "Installation" }),
  ],
  "IDP-ZONE": [
    fact("module_type", "Zone Module", { srcDoc: DOC_ZONE, section: "Product Description" }),
    fact("device_role", "2-Wire Conventional Zone Interface", { srcDoc: DOC_ZONE, section: "Product Description" }),
    fact("conventional_zone_interface_capability", "Converts one full zone of 2-wire conventional smoke detectors to an addressable SLC point; reports normal/open/alarm; supervises the zone and the external power supply connection; supports Style B and Style D wiring", { srcDoc: DOC_ZONE, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_ZONE, section: "Product Description" }),
    compatPanels(DOC_ZONE),
    voltage1532(DOC_ZONE),
    fact("mounting_requirement", "4in square electrical box, min 2-1/8in depth; SMB500 surface mount box available", { operator: "Informational", srcDoc: DOC_ZONE, page: 1, section: "Installation" }),
  ],
  "IDP-ISO": [
    fact("module_type", "Isolator Module", { srcDoc: DOC_ISO, section: "Product Description" }),
    fact("device_role", "Single-Circuit SLC Line Isolator", { srcDoc: DOC_ISO, section: "Product Description" }),
    fact("isolation_capability", "Opens automatically when SLC line voltage drops below 4V; isolates a group of up to 25 devices between isolators; automatically restores when the short is corrected", { srcDoc: DOC_ISO, section: "Product Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_ISO, section: "Product Description" }),
    compatPanels(DOC_ISO),
    voltage1532(DOC_ISO),
    fact("mounting_requirement", "4in square electrical box, min 2-1/8in depth; SMB500 surface mount box available", { operator: "Informational", srcDoc: DOC_ISO, page: 1, section: "Installation" }),
  ],
  "ISO-6": [
    fact("module_type", "Isolator Module", { srcDoc: DOC_ISO_6, section: "Product Description" }),
    fact("device_role", "Six-Circuit SLC Line Isolator (Multi-Module Board)", { srcDoc: DOC_ISO_6, section: "Product Description" }),
    fact("isolation_capability", "Opens automatically when SLC line voltage drops below 4V per circuit; six independent Class B isolator circuits, up to 25 devices between isolators per circuit; automatically restores when the short is corrected", { srcDoc: DOC_ISO_6, section: "Product Description" }),
    fact("compatible_panel_families", "IFP-2000, RPS-2000, IFP-2000ECS, IFP-1000, IFP-1000ECS, IFP-100, IFP-100ECS, IFP-50, IFP-25", { operator: "Informational", srcDoc: DOC_ISO_6, page: 1, section: "Compatibility" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_ISO_6, page: 2, section: "Electrical" }),
    fact("mounting_requirement", "Up to two modules per IDP-ACB accessory cabinet", { operator: "Informational", srcDoc: DOC_ISO_6, page: 2, section: "Ordering Information" }),
  ],
};

const STANDARDS = {
  "IDP-MONITOR": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "427-91-E Vol. X" }],
  "IDP-MINIMON": [{ body: "UL", number: "Approved" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "457-99-E Vol. V" }],
  "IDP-MONITOR-2": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "457-99-E Vol. V" }],
  "IDP-MONITOR-10": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "386-02-E Vol. II" }],
  "IDP-CONTROL": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "386-02-E Vol. II" }],
  "IDP-CONTROL-6": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "386-02-E Vol. II" }],
  "IDP-RELAY": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "386-02-E Vol. II" }],
  "IDP-RELAY-6": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "386-02-E Vol. II" }],
  "IDP-RELAYMON-2": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "FM", number: "Approved" }],
  "IDP-ZONE": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "386-02-E Vol. II" }],
  "IDP-ISO": [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "427-91-E Vol. X" }],
  "ISO-6": [{ body: "UL", number: "Listed" }, { body: "FM", number: "Approved" }, { body: "CSFM", number: "Listed" }],
  "WIDP-MONITOR": [{ body: "UL", number: "S3511" }, { body: "CSFM", number: "7300-0559:0507" }, { body: "FM", number: "Approved" }, { body: "UL", number: "864" }, { body: "UL", number: "268" }],
  "WIDP-RELAY": [{ body: "UL", number: "S3511" }, { body: "CSFM", number: "7300-0559:0508" }, { body: "FM", number: "Approved" }, { body: "UL", number: "864" }, { body: "UL", number: "268" }],
};
const STANDARDS_DOC = { "IDP-MONITOR": DOC_MONITOR, "IDP-MINIMON": DOC_MINIMON, "IDP-MONITOR-2": DOC_MONITOR_2, "IDP-MONITOR-10": DOC_MONITOR_10, "IDP-CONTROL": DOC_CONTROL, "IDP-CONTROL-6": DOC_CONTROL_6, "IDP-RELAY": DOC_RELAY, "IDP-RELAY-6": DOC_RELAY_6, "IDP-RELAYMON-2": DOC_RELAYMON_2, "IDP-ZONE": DOC_ZONE, "IDP-ISO": DOC_ISO, "ISO-6": DOC_ISO_6, "WIDP-MONITOR": DOC_WIDP_MON_REL, "WIDP-RELAY": DOC_WIDP_MON_REL };

// [productPN, accessoryPN, relationshipType, doc]
const ACCESSORIES = [
  ["IDP-MONITOR", "SMB500", "Compatible Backbox", DOC_MONITOR],
  ["IDP-MONITOR-2", "SMB500", "Compatible Backbox", DOC_MONITOR_2],
  ["IDP-MONITOR-10", "IDP-ACB", "Compatible Cabinet", DOC_MONITOR_10],
  ["IDP-CONTROL", "SMB500", "Compatible Backbox", DOC_CONTROL],
  ["IDP-CONTROL", "CB500", "Required Wiring Barrier", DOC_CONTROL],
  ["IDP-CONTROL", "EOLR-1", "Required End-of-Line Relay", DOC_CONTROL],
  ["IDP-CONTROL-6", "IDP-ACB", "Compatible Cabinet", DOC_CONTROL_6],
  ["IDP-CONTROL-6", "EOLR-1", "Required End-of-Line Relay", DOC_CONTROL_6],
  ["IDP-RELAY", "SMB500", "Compatible Backbox", DOC_RELAY],
  ["IDP-RELAY", "CB500", "Required Wiring Barrier", DOC_RELAY],
  ["IDP-RELAY-6", "IDP-ACB", "Compatible Cabinet", DOC_RELAY_6],
  ["IDP-RELAYMON-2", "SMB500", "Compatible Backbox", DOC_RELAYMON_2],
  ["IDP-ZONE", "SMB500", "Compatible Backbox", DOC_ZONE],
  ["IDP-ISO", "SMB500", "Compatible Backbox", DOC_ISO],
  ["ISO-6", "IDP-ACB", "Compatible Cabinet", DOC_ISO_6],
  ["WIDP-MONITOR", "SMB500", "Compatible Backbox", DOC_WIDP_MON_REL],
  ["WIDP-RELAY", "SMB500", "Compatible Backbox", DOC_WIDP_MON_REL],
];

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, ?, 'One per module', '[]', 0, 1, ?, 90, 'Approved', 'sprint-1.34-module-interface-seed')");
const existingAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND deleted_at IS NULL AND superseded_at IS NULL");

let attrsAdded = 0, attrsSkipped = 0, stdsAdded = 0, stdsSkipped = 0, accAdded = 0, accSkipped = 0, garbledFixed = 0;

if (apply) db.exec("BEGIN IMMEDIATE");
try {
  // Fix garbled pre-existing data defects found this sprint.
  for (const partNumber of ["WIDP-MONITOR", "WIDP-RELAY"]) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.attributes || "[]");
    const garbled = existing.filter((a) => a.name === "Current" && a.originalValue === "123A");
    if (garbled.length) {
      const cleaned = existing.filter((a) => !(a.name === "Current" && a.originalValue === "123A"));
      console.log(`${apply ? "REMOVE" : "WOULD REMOVE"}: ${partNumber} -> garbled Current=123A attribute (parsed from CR-123A battery text)`);
      if (apply) updateAttributes.run(JSON.stringify(cleaned), product.id);
      garbledFixed += 1;
    }
  }
  {
    const product = getProduct.get("IDP-RELAY");
    const existing = JSON.parse(product.standards || "[]");
    const garbled = existing.filter((s) => s.body === "ISO" && s.number === "lated");
    if (garbled.length) {
      const cleaned = existing.filter((s) => !(s.body === "ISO" && s.number === "lated"));
      console.log(`${apply ? "REMOVE" : "WOULD REMOVE"}: IDP-RELAY -> garbled standard {"body":"ISO","number":"lated"} (parsed from "Isolated")`);
      if (apply) updateStandards.run(JSON.stringify(cleaned), product.id);
      garbledFixed += 1;
    }
  }

  for (const [partNumber, attrs] of Object.entries(PRODUCT_ATTRIBUTES)) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.attributes || "[]");
    const existingNames = new Set(existing.map((e) => norm(e.name)));
    const toAdd = attrs.filter((a) => !existingNames.has(norm(a.name)));
    for (const a of attrs.filter((a) => existingNames.has(norm(a.name)))) { console.log(`SKIP (already present): ${partNumber} -> ${a.name}`); attrsSkipped += 1; }
    if (toAdd.length) {
      for (const a of toAdd) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${a.name} = ${JSON.stringify(a.normalizedValue)}`);
      const fresh = JSON.parse(getProduct.get(partNumber).attributes || "[]");
      if (apply) updateAttributes.run(JSON.stringify([...fresh, ...toAdd]), product.id);
      attrsAdded += toAdd.length;
    }
  }

  for (const [partNumber, stds] of Object.entries(STANDARDS)) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(getProduct.get(partNumber).standards || "[]");
    const existingKeys = new Set(existing.map((e) => `${norm(e.body)}:${norm(e.number)}`));
    const toAdd = stds.filter((s) => !existingKeys.has(`${norm(s.body)}:${norm(s.number)}`));
    for (const s of stds.filter((s) => existingKeys.has(`${norm(s.body)}:${norm(s.number)}`))) { console.log(`SKIP (already present): ${partNumber} -> ${s.body} ${s.number}`); stdsSkipped += 1; }
    if (toAdd.length) {
      const srcDoc = STANDARDS_DOC[partNumber];
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 88, source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url } }));
      for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
      if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
      stdsAdded += appended.length;
    }
  }

  for (const [productPN, accessoryPN, relationshipType, srcDoc] of ACCESSORIES) {
    const product = getProduct.get(productPN);
    if (!product) throw new Error(`Product not found: ${productPN}`);
    const accessory = getProduct.get(accessoryPN);
    if (!accessory) throw new Error(`Accessory product not found: ${accessoryPN}`);
    if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${productPN} -> ${accessoryPN}`); accSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${productPN} -> ${relationshipType}: ${accessoryPN}`);
    if (apply) insertAccessory.run(id("productaccessory"), product.id, accessory.id, relationshipType, JSON.stringify([{ sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url }]));
    accAdded += 1;
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} accessory relationships (${accSkipped} skipped); ${garbledFixed} garbled pre-existing data defects removed.`);
console.log("Reported gaps: WIDP-ZONE / WIDP-ISO do not exist in this catalog (no wireless Zone or Isolator module). The '123A' garbled-attribute pattern also affects 10 other catalog products in unrelated families (WIDP-HEAT, WIDP-PHOTO, WIDP-HEAT-ROR, WIDP-ACCLIMATE, WIDP-PULL-DA, WAV-CRL, WAV-CWL, WAV-RL, WAV-WL, W-SYNC) -- out of this sprint's Modules and Interfaces scope, not fixed here.");
