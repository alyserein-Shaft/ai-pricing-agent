#!/usr/bin/env node
/**
 * Records the human substitution decision for the BOQ "loop powered" notification
 * appliances as ONE governed decision row.
 *
 * WHY A SUBSTITUTION AND NOT A PRODUCT CREATION. Independent investigation this
 * session reproduced, from first-party documents, the architecture already
 * recorded in EV-20260930-NOTIFICATION-AND-PANEL-ARCHITECTURE: the IFP-2100
 * manual LS10143-001SK-E:C states "The control panel supports the use of either
 * IDP, SK, or SD SLC devices. You cannot install a mix of SLC device types on
 * the control panel", and enumerating that manual's own IDP/SK device list
 * (31 part numbers) yields NO strobe, horn, speaker or beacon. The IDP protocol
 * has no visual appliance. The only Honeywell loop-powered AV (Notifier FS-AV =
 * FlashScan, NFXI = Opal) is a different protocol and cannot run on an IFP-2100.
 * So no product can satisfy "loop powered" as written, and creating one would
 * fabricate a compatibility no document supports.
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO. The human decision reserves
 * candela, NAC circuit count, power-supply count and control-module count as
 * SIZING OUTPUTS. This script therefore records the architecture and the
 * prohibition on one-to-one conversion, and asserts NO quantity, NO candela and
 * NO circuit count. It also does not touch the pre-existing "Project Fire Alarm
 * Ecosystem" (NOTIFIER) row, and it does not create or promote any product.
 *
 * Idempotency is keyed on entity_id, which is where the content-derived key is
 * stored -- the same lesson recorded in the brand-decision recorder, whose first
 * version searched free text and silently duplicated rows on every re-run.
 *
 * Usage:
 *   node scripts/record-al-mousa-fire-alarm-notification-substitution.mjs <db-path> --dry-run
 *   node scripts/record-al-mousa-fire-alarm-notification-substitution.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388"; // Al Mousa School
const PROJECT_NAME = "Al Mousa School";
const ENTITY = "Fire Alarm Notification Architecture";
const DECIDED_BY = "authoritative-engineer-decision";
const DECIDED_ROLE = "Project Engineer (authoritative human decision)";

const args = process.argv.slice(2);
const DB = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
if (!DB || (!APPLY && !args.includes("--dry-run"))) {
  throw new Error(
    "Usage: record-al-mousa-fire-alarm-notification-substitution.mjs <db-path> --dry-run|--apply",
  );
}

// The decision itself. Note what is ABSENT: candela values, NAC circuit counts,
// power-supply counts, control-module counts and any SLC address total.
const DECISION = {
  boqLabelInterpretation: "LOOP_POWERED_LABEL_IS_NOT_DEVICE_TOPOLOGY",
  substitution: "ACCEPTED",
  notificationArchitecture: "CONVENTIONAL_NAC",
  permittedNacDistribution: [
    "IFP2100_ONBOARD_FLEXPUT_NAC",
    "REMOTE_LISTED_NAC_POWER_SUPPLY",
    "IDP_CONTROL_MODULE",
    "IDP_CONTROL_6_MODULE",
  ],
  selectionDrivers: [
    "CIRCUIT_TOPOLOGY",
    "SYNCHRONIZATION",
    "CURRENT_LOAD",
    "VOLTAGE_DROP_CALCULATION",
  ],
  boqQuantityToSlcAddressConversion: "PROHIBITED_ONE_TO_ONE",
  reservedSizingOutputs: [
    "FINAL_CANDELA",
    "NAC_CIRCUIT_COUNT",
    "POWER_SUPPLY_COUNT",
    "CONTROL_MODULE_COUNT",
  ],
  loopPoweredAvRejected: [
    "FS-WSO", "FS-WST", "FS-WSS", "FS-BSO", "FS-BSS", "NFXI-BF-SERIES",
  ],
  rejectionBasis: [
    "NO_IDP_PROTOCOL_LOOP_POWERED_NOTIFICATION_APPLIANCE_EXISTS",
    "FS_AV_FLASH_INTENSITY_GT_1CD_BELOW_MANDATORY_15_110_CD_DUTY",
    "NO_OUTDOOR_VARIANT_FOR_EXTERIOR_UNITS",
    "FLASHSCAN_AND_OPAL_PROTOCOLS_INCOMPATIBLE_WITH_IDP_PANEL",
  ],
  ratifies: "EV-20260930-NOTIFICATION-AND-PANEL-ARCHITECTURE",
};

const REASON =
  "Human substitution decision. The BOQ/legend label 'loop powered' is accepted as NOT the device " +
  "topology, and the visual and audible-visual notification appliances are substituted with a " +
  "Farenhyt-compatible conventional NAC architecture. NAC distribution may use IFP-2100 onboard " +
  "Flexput NAC outputs, remote listed NAC power supplies, and/or IDP-CONTROL and IDP-CONTROL-6 " +
  "modules as required by circuit topology, synchronization, current load and voltage-drop " +
  "calculations. BOQ appliance quantities are NOT converted one-for-one into SLC module addresses. " +
  "Final candela, NAC circuit count, power-supply count and control-module count remain sizing " +
  "outputs and are deliberately NOT asserted here. Confirmed independently this session: the " +
  "IFP-2100 manual LS10143-001SK-E:C permits only IDP, SK or SD SLC devices and states 'You cannot " +
  "install a mix of SLC device types on the control panel'; its own IDP/SK device list of 31 part " +
  "numbers contains no strobe, horn, speaker or beacon; and the IDP-Control datasheet 350293 Rev H " +
  "describes supervising 'load devices that require an external power supply to operate, such as " +
  "bells, horns, and strobes'.";

const EVIDENCE = [
  "LS10143-001SK-E:C (IFP-2100/IFP-2100ECS install manual) - protocol exclusivity and IDP/SK device list",
  "350293 Rev H (IDP-Control addressable notification module datasheet) - external power supply for load devices",
  "docs/fire-alarm-brand-and-pre-sales-policy.md (in-house Farenhyt routing)",
  "EV-20260930-NOTIFICATION-AND-PANEL-ARCHITECTURE (prior recorded architecture, ratified here)",
  "Live BOQ: 4380 units across 150 lines / 7 projects, zero candela, voltage or protocol wording stored",
];

// Content-derived idempotency key, stored in entity_id.
const idem = (project, entity, value) =>
  createHash("sha256").update(`${project}\u001f${entity}\u001f${JSON.stringify(value)}`).digest("hex").slice(0, 32);
const IDEM = idem(PROJECT_ID, ENTITY, DECISION);

console.log(`\n${"=".repeat(72)}`);
console.log(`GOVERNED DECISION -- ${ENTITY}`);
console.log(`${"=".repeat(72)}`);
console.log(`project        : ${PROJECT_NAME} (${PROJECT_ID})`);
console.log(`mode           : ${APPLY ? "APPLY (writes to engineering_knowledge_decisions)" : "DRY RUN (no writes)"}`);
console.log(`idempotency key: ${IDEM}`);
console.log(`decided by     : ${DECIDED_BY} (${DECIDED_ROLE})`);
console.log("");

const db = new DatabaseSync(DB);

const existing = db
  .prepare(
    "SELECT id, decided_at FROM engineering_knowledge_decisions WHERE project_id=? AND entity_type=? AND entity_id=? LIMIT 1",
  )
  .get(PROJECT_ID, ENTITY, IDEM);

if (existing) {
  console.log(`  [NO-OP] already recorded at ${existing.decided_at} (idempotency key stable)`);
} else if (APPLY) {
  db.prepare(
    `INSERT INTO engineering_knowledge_decisions
       (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence,
        scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    `${ENTITY.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${randomUUID()}`,
    PROJECT_ID, ENTITY, IDEM, "decide",
    null, JSON.stringify(DECISION), REASON, JSON.stringify(EVIDENCE),
    "PROJECT", PROJECT_ID, 1, null, DECIDED_BY, DECIDED_ROLE, new Date().toISOString(),
  );
  console.log(`  [WROTE] ${ENTITY}`);
  console.log(`          substitution            = ${DECISION.substitution}`);
  console.log(`          architecture            = ${DECISION.notificationArchitecture}`);
  console.log(`          1:1 SLC conversion      = ${DECISION.boqQuantityToSlcAddressConversion}`);
  console.log(`          reserved sizing outputs = ${DECISION.reservedSizingOutputs.join(", ")}`);
} else {
  console.log(`  [DRY]  would write ${ENTITY}`);
  console.log(`          substitution            = ${DECISION.substitution}`);
  console.log(`          architecture            = ${DECISION.notificationArchitecture}`);
  console.log(`          1:1 SLC conversion      = ${DECISION.boqQuantityToSlcAddressConversion}`);
  console.log(`          reserved sizing outputs = ${DECISION.reservedSizingOutputs.join(", ")}`);
}

// Invariants this script must never violate.
const total = db.prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions").get().c;
const eco = db
  .prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions WHERE entity_type='Project Fire Alarm Ecosystem'")
  .get().c;
console.log("");
console.log(`  engineering_knowledge_decisions total : ${total}`);
console.log(`  'Project Fire Alarm Ecosystem' rows   : ${eco}  (untouched)`);
db.close();
console.log("");
console.log(existing ? "  DECISION PERSISTENCE: NOTHING TO DO" : "  DECISION PERSISTENCE: OK");
