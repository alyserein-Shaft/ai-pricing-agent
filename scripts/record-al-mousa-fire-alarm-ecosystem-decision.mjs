#!/usr/bin/env node
/**
 * PERSISTS THE EXISTING HUMAN/PROJECT DECISION that establishes Honeywell /
 * NOTIFIER as the Fire Alarm compatibility basis for Al Mousa School — Clean
 * Golden Run.
 *
 * This script does NOT decide anything. It records a decision that already
 * exists, through the canonical governed path:
 *
 *   app/domain/fire-alarm-ecosystem-decision.mjs   (validation + write plan)
 *   worker/fire-alarm-ecosystem-decision-api.mjs   (the only writer; mirrored
 *                                                  here statement-for-statement)
 *
 * Storage is `engineering_knowledge_decisions` verbatim. No migration, no new
 * table, no new column.
 *
 * WHAT IS BEING RECORDED, AND WHAT IS NOT:
 *
 *   ecosystem / compatibility basis ... NOTIFIER  (Honeywell)
 *   technical platform direction .... NOTIFIER / FlashScan
 *   contractualManufacturerAcceptance CONSULTANT_APPROVAL_REQUIRED
 *
 * The decision establishes the governed compatibility TARGET so technical
 * matching and panel sizing can proceed. It does NOT assert Consultant
 * approval, does NOT select a final panel, and does NOT authorize substitution.
 * The domain validator independently REFUSES a record that claims a selected or
 * Consultant-approved panel, so those cannot be smuggled in through the input.
 *
 * COMPLIANCE NOTE (investigated this session, not assumed):
 * The project specification "28 46 00 - Fire Detection and Alarm System" v1
 * explicitly names "UL864, 10 Edition, 2014" in its reference-standards list,
 * and separately requires UL864-compliant transient protection and UL864 power
 * limitation. The governing `ul864GoverningEdition` field is therefore NOT
 * flipped here: the extracted requirement row is still review_status='Needs
 * Review', approved_for_downstream=0, so promoting it to ESTABLISHED is a
 * separate governed approval step and not this script's call. The edition is
 * used below as a PRODUCT EVALUATION CRITERION only.
 *
 * Usage:
 *   node scripts/record-al-mousa-fire-alarm-ecosystem-decision.mjs <db-path> --dry-run
 *   node scripts/record-al-mousa-fire-alarm-ecosystem-decision.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import {
  ECOSYSTEM_DECISION_ENTITY_TYPE,
  planEcosystemDecisionWrite,
  validateProjectFireAlarmEcosystemDecision,
} from "../app/domain/fire-alarm-ecosystem-decision.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) {
  throw new Error("Usage: record-al-mousa-fire-alarm-ecosystem-decision.mjs <db-path> --dry-run|--apply");
}
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const PROJECT_NAME = "Al Mousa School — Clean Golden Run";
const SPEC_VERSION = "28 46 00 - Fire Detection and Alarm System, document version v1";
const DECIDED_BY = "local-development-user";
const DECIDED_ROLE = "Project Owner (recorded existing project decision)";

// The already-established project decision, transcribed verbatim.
const input = {
  ecosystem: "NOTIFIER",
  primaryProtocol: "FlashScan",
  allowedLegacyProtocols: ["CLIP"],
  preliminaryPanelFamily: {
    key: "INSPIRE_N16",
    isSelected: false,
    isConsultantApproved: false,
    eligibility: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
  },
  complianceBasisState: "PARTIALLY_RESOLVED",
  contractualManufacturerAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
  substitutionAuthority: "HUMAN_APPROVAL_REQUIRED",
  directMatchPolicy:
    "Direct technical match is permitted only inside the NOTIFIER ecosystem. Any product outside it is an equivalence candidate requiring a governed human decision; the system may only ever propose APPROVED_EQUIVALENT.",
  notDirectMatchEcosystems: [],
  appliesWhile:
    "Applies while this project's BOQ and specification remain current for the Fire Alarm scope and the named manufacturer remains contractually required. It is a technical design basis only, and expires with the project specification version it was decided against.",
  evidence: [
    "Project specification 28 46 00 - Fire Detection and Alarm System v1, which names Honeywell / Notifier as the required fire alarm manufacturer and references both Flash Scan and CLIP protocol systems.",
    "Project BOQ (BOQ.xlsx v1) Fire Alarm lines, whose device population is only satisfiable by a Notifier addressable SLC architecture.",
    "Existing project decision: Honeywell / NOTIFIER shall be used as the Fire Alarm Compatibility Basis for technical matching and panel sizing.",
  ],
  reason:
    "Honeywell / NOTIFIER is the established Fire Alarm compatibility basis for this project. The specification names the manufacturer and both the Flash Scan and CLIP protocol systems, and the governed device population can only be satisfied inside the Notifier ecosystem. Recording it establishes the compatibility target so requirement generation, technical matching and panel sizing stop failing closed. It is a technical design basis only: contractual manufacturer acceptance remains CONSULTANT_APPROVAL_REQUIRED, no panel is selected, and no substitution is authorised.",
  decidedBy: DECIDED_BY,
  decidedRole: DECIDED_ROLE,
  specificationVersion: SPEC_VERSION,
};

// ---- Fail closed before touching anything. -------------------------------
let candidate;
try {
  candidate = validateProjectFireAlarmEcosystemDecision(input);
} catch (error) {
  console.error(`REFUSED (${error.code}): ${error.message}`);
  process.exit(1);
}

const readCurrent = () => {
  const rows = db
    .prepare(
      "SELECT id, project_id, entity_type, action, new_value, decided_at, reverses_decision_id FROM engineering_knowledge_decisions WHERE project_id=? AND entity_type=? ORDER BY decided_at ASC, id ASC",
    )
    .all(PROJECT_ID, ECOSYSTEM_DECISION_ENTITY_TYPE);
  const reversed = new Set(rows.map((row) => row.reverses_decision_id).filter(Boolean));
  const current = rows.filter((row) => !reversed.has(row.id));
  if (!current.length) return null;
  const row = current[current.length - 1];
  let payload = row.new_value;
  try {
    payload = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    return null;
  }
  return { id: row.id, action: row.action, decidedAt: row.decided_at, decision: payload };
};

const current = readCurrent();
const plan = planEcosystemDecisionWrite({ current, candidate });

console.log(`project: ${PROJECT_NAME} (${PROJECT_ID})`);
console.log(`ecosystem: ${candidate.ecosystem}  ->  compatibilityTarget: ${candidate.compatibilityTarget}`);
console.log(`primary protocol: ${candidate.primaryProtocol} (${candidate.primaryProtocolState})`);
console.log(
  `legacy/exception protocols: ${candidate.allowedLegacyProtocols.map((entry) => entry.protocol).join(", ") || "none"}`,
);
console.log(`preliminary panel family: ${candidate.preliminaryPanelFamily.family} (${candidate.preliminaryPanelFamily.eligibility})`);
console.log(`  N16x is a ${candidate.preliminaryPanelFamily.candidateKinds.N16x} on ${candidate.preliminaryPanelFamily.personaUpgrade.from} via ${candidate.preliminaryPanelFamily.personaUpgrade.licence}`);
console.log(`contractualManufacturerAcceptance: ${candidate.contractualManufacturerAcceptance}`);
console.log(`substitutionAuthority: ${candidate.substitutionAuthority}  proposedSubstitutionState: ${candidate.proposedSubstitutionState}`);
console.log(`panel selected: ${candidate.preliminaryPanelFamily.isSelected}   consultant approved: ${candidate.preliminaryPanelFamily.isConsultantApproved}`);
console.log(`write plan: ${plan.mode}${plan.decisionId ? ` (existing ${plan.decisionId})` : ""}`);

if (plan.mode === "idempotent") {
  console.log("\nIDEMPOTENT: an identical current decision already governs this project. No write performed.");
  process.exit(0);
}

if (!apply) {
  console.log(`\nDRY RUN: would INSERT action="${plan.action}" reverses=${plan.reversesDecisionId ?? "null"}`);
  process.exit(0);
}

const decisionId = id("ecosystemDecision");
const stamp = now();
db.exec("BEGIN IMMEDIATE");
try {
  db.prepare(
    "INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
  ).run(
    decisionId,
    PROJECT_ID,
    ECOSYSTEM_DECISION_ENTITY_TYPE,
    PROJECT_ID,
    plan.action,
    plan.previousValue ? JSON.stringify(plan.previousValue) : null,
    JSON.stringify(candidate),
    candidate.reason,
    JSON.stringify({
      evidence: candidate.evidence,
      specificationVersion: candidate.specificationVersion,
    }),
    "Project",
    PROJECT_ID,
    plan.reversesDecisionId,
    candidate.decidedBy,
    candidate.decidedRole,
    stamp,
  );
  db.prepare(
    "INSERT INTO document_audit_events (id, project_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id("audit"),
    PROJECT_ID,
    candidate.decidedBy,
    plan.mode === "supersede"
      ? "Fire Alarm Ecosystem Decision Superseded"
      : "Fire Alarm Ecosystem Decision Recorded",
    JSON.stringify(plan.previousValue || {}),
    JSON.stringify({
      decisionId,
      ecosystem: candidate.ecosystem,
      protocols: candidate.protocols,
      complianceBasisState: candidate.complianceBasisState,
      supersedes: plan.reversesDecisionId,
    }),
    candidate.reason,
    id("request"),
  );
  db.exec("COMMIT");
  console.log(`\nAPPLIED: decisionId=${decisionId} action=${plan.action} decidedAt=${stamp}`);
} catch (error) {
  db.exec("ROLLBACK");
  console.error(`FAILED and rolled back: ${error.message}`);
  process.exit(1);
}
