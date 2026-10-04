/**
 * GOLDEN-6B -- GOVERNED FIRE ALARM STANDARDS & COMPLIANCE EVIDENCE RESOLVER.
 *
 * Proves the pure-domain resolver (app/domain/fire-alarm-compliance-evidence-
 * policy.mjs): governed project evidence about standards/certifications is
 * converted into canonical compliance facts (Layer B) WITHOUT fabricating
 * equivalence, conflicts fail closed, higher-authority supersession is the only
 * conflict resolution (old facts stay historical), and the policy adapter
 * (Layer C) feeds ONLY GOLDEN-5's `complianceRegime` input -- never an
 * ecosystem or a panel model.
 *
 * Mission correlation (acceptance §29, negatives §30, profile lifecycle §33,
 * supersession §34, GOLDEN-5 adapter boundary §27):
 *   *  SYSTEM-WIDE UL              -> canonical requiredCertifications=["UL"],
 *      adapter UL_FM_POLICY_BRANCH, regime "UL/FM" (no FM fabricated).
 *   *  EN54 + LPCB                 -> EN54_LPCB_POLICY_BRANCH, GOLDEN-5 GENT.
 *   *  EN54 only / LPCB only       -> NO_SUPPORTED_ECOSYSTEM_BRANCH, regime null
 *      -> GOLDEN-5 MISSING_FIRE_ALARM_COMPLIANCE_BASIS (NEVER GENT).
 *   *  NFPA only                   -> no regime; no UL/FM invented.
 *   *  Detector-only UL            -> PRODUCT_CERTIFICATION, never a system
 *      route (scope participation); FACP UL establishes the UL basis (§25).
 *   *  UL + EN54/LPCB, system-wide -> CONFLICTING_COMPLIANCE_EVIDENCE; mention
 *      counts / recency / vendor NEVER break the tie.
 *   *  Manufacturer capability    -> never a contractual mandate.
 *   *  Ineligible rows             -> refused, never evidence.
 *   *  Profile lifecycle (§33)     -> adding a governed requirement_standards
 *      child clears missingInformation.standard, moves the fingerprint, mints
 *      v2, supersedes v1; idempotent no-change rerun stays on v2.
 *
 * The §33 replica seeds a minimal project through the REAL executeRequirementProfile
 * (worker/technical-requirement-api.mjs), replicating the GOLDEN-6 fixture
 * pattern. The acceptance project's data is never touched (read-only there).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  FIRE_ALARM_COMPLIANCE_EVIDENCE_POLICY_VERSION,
  MENTION_CLASSIFICATIONS,
  AUTHORITY_CLASSES,
  COMPLIANCE_SCOPES,
  OBLIGATIONS,
  COMPLIANCE_RESOLUTION_STATES,
  POLICY_BRANCHES,
  CONCEPT_TYPES,
  recognizeStandardsConcept,
  classifyEvidenceEntry,
  resolveComplianceEvidence,
  deriveCompliancePolicyBranch,
  buildFireAlarmComplianceAdapterResult,
} from "../app/domain/fire-alarm-compliance-evidence-policy.mjs";
import {
  resolveFireAlarmEcosystem,
  RESOLVED_ECOSYSTEM_TARGETS,
} from "../app/domain/fire-alarm-ecosystem-policy.mjs";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { currentRequirementProfile } from "../worker/requirement-profile-currency.mjs";

const OWNER = "golden6b-engineer";
const PROJECT = "golden6b-project";
const PANEL = "golden6b-panel";
const REQ_COMPLIANCE = "golden6b-req-compliance";

/* ------------------------------------------------------------------ *
 * Fixture helpers
 * ------------------------------------------------------------------ */

// One governed evidence entry in the canonical dialect: a requirement_standards
// child row or an applicable_standard Source Fact row, already eligibility and
// currency gated by the caller (the SAME rows the requirement engine consumes).
const std = (entry) => ({
  kind: "requirement_standard",
  reviewStatus: "Approved",
  approvedForDownstream: 1,
  current: true,
  ...entry,
});

const spec = (id, body, number, text) =>
  std({ id, body, number, originalText: text, sourceType: "Technical Specification" });

// Live acceptance project's ELIGIBLE requirement_standards (read-only replica of
// the shape only; the real ids/rows live in the acceptance-run snapshot D1):
// req_75 UL system-wide listing, req_78 NFPA-72/75 + EN54
// installation, req_79 detectors UL 217/268, req_316 SLC NFPA 72.
const LIVE_ELIGIBLE_EVIDENCE = () => [
  spec("req75-ul", "UL", null, "Every component of the fire alarm system shall be listed under a single manufacturer, approved by Underwriters Laboratories (UL), with a complete traceability record."),
  spec("req78-nfpa72", "NFPA", "72", "The complete installation shall adhere to applicable sections of NFPA-72, 75, EN54, and relevant electrical codes (IEC/BS EN)."),
  spec("req78-en54", "EN54", null, "The complete installation shall adhere to applicable sections of NFPA-72, 75, EN54, and relevant electrical codes (IEC/BS EN)."),
  spec("req79-ul217", "UL", "217", "Fire alarm detectors must be UL certified to the 8th Edition of UL 217 and the 7th Edition of UL 268, ensuring resistance to nuisance alarms."),
  spec("req79-ul268", "UL", "268", "Fire alarm detectors must be UL certified to the 8th Edition of UL 217 and the 7th Edition of UL 268, ensuring resistance to nuisance alarms."),
  spec("req316-nfpa72", "NFPA", "72", "Each SLC must accommodate NFPA 72 Style 4, Style 6, or Style 7 (Class A or B) wiring configurations."),
];

const LPCB_SYSTEM = () => [
  std({ id: "en54-sys", body: "EN54", number: null, originalText: "The fire alarm system shall comply with EN54.", sourceType: "Technical Specification" }),
  std({ id: "lpcb-sys", body: "LPCB", number: null, originalText: "The fire alarm system installation shall be approved by the Loss Prevention Certification Board (LPCB).", sourceType: "Technical Specification" }),
];

/* ------------------------------------------------------------------ *
 * Replica helpers for the §33 profile-lifecycle proof (GOLDEN-6 pattern)
 * ------------------------------------------------------------------ */

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => {
        const result = raw.prepare(sql).run(...args);
        return { ...result, meta: { changes: Number(result.changes || 0), last_insert_rowid: result.lastInsertRowid } };
      },
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const activeChain = async () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of migrations) {
    const sql = await readFile(`${directory}${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return raw;
};

const envFor = (raw) => ({
  DB: d1(raw),
  FILES: { get: async () => null, head: async () => null },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "golden6b@test.invalid",
  APP_USER_NAME: "GOLDEN-6B Technical Manager",
  waitUntil: () => undefined,
});

// Minimal Fire Alarm project: one FACP BOQ item, one approved current eligible
// Compliance requirement, a Confirmed link, and NO requirement_standards child
// rows yet (the v1 "standard missing" condition). Mirrors the GOLDEN-6 seed.
const seedProfileReplica = async () => {
  const raw = await activeChain();
  const now = new Date().toISOString();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);

  run("INSERT INTO organizations (id,name) VALUES (?,?)", "org1", "GOLDEN-6B Org");
  run("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)",
    PROJECT, "GOLDEN-6B Profile Replica", OWNER, "org1", "Fire Alarm", "Active");
  run("INSERT INTO project_members (id,project_id,user_id,role,status,granted_by,granted_at) VALUES (?,?,?,?,?,?,?)",
    "member1", PROJECT, OWNER, "Technical Manager", "Active", OWNER, now);
  run("INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by,current_version_id) VALUES (?,?,?,?,?,?,?)",
    "doc1", PROJECT, "BOQ", "BOQ", "Manual", OWNER, "dv1");
  run(`INSERT INTO document_versions
    (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,effective_from,uploaded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, "dv1", "doc1", 1, "boq.pdf", "boq.stored", "pdf", "application/pdf", 10, "sha-1", "p/boq.pdf", "2026-01-01", OWNER);
  run(`INSERT INTO boq_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`, "bx1", "doc1", "dv1", 1, "Completed", "p1", "r1", "o1", OWNER);
  run(`INSERT INTO specification_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,superseded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, "sx1", "doc1", "dv1", 1, "Completed", "p1", "r1", "m1", "pr1", "o1", OWNER, null);
  run(`INSERT INTO specification_clauses (id,extraction_version_id,sequence,kind,path,original_text) VALUES (?,?,?,?,?,?)`,
    "cl1", "sx1", 1, "Requirement", "1", "System requirements");

  run(`INSERT INTO boq_items
    (id,extraction_version_id,project_id,source_document_id,sequence,hierarchy_depth,section_path,row_type,item_number,description,system_value,category,
     normalized_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,
     approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    PANEL, "bx1", PROJECT, "doc1", 1, 0, "1", "Item", "1", "Main Fire alarm control panel with all required hardware, interfaces, cabling, and accessories. Panel shall be listed under UL 864.", "Fire Alarm", "Control Equipment", "EA", 1, 1,
    95, "High Confidence", "Approved", "{}", "{}", "{}", 1, now, now);

  run(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    REQ_COMPLIANCE, "sx1", PROJECT, "doc1", "cl1", 1, "The fire alarm system and every component shall be listed under one governing listing body, approved by Underwriters Laboratories (UL).", "the fire alarm system and every component shall be listed under one governing listing body, approved by underwriters laboratories (ul).", "Fire Alarm", "Explicit",
    "Fire Alarm", "Control Equipment", "Mandatory", "Compliance", 90, "High Confidence", "Approved", "human-engineering-decision", "p1", "m1",
    JSON.stringify({ basis: "HUMAN_ENGINEERING_DECISION" }), "{}", "{}", 1, now, now);

  run(`INSERT INTO boq_requirement_links
    (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    "link-1", PROJECT, PANEL, REQ_COMPLIANCE, "Governed Applicability", 95, JSON.stringify([{ basis: "APPROVED_PROJECT_WIDE_REQUIREMENT" }]), "Confirmed", "BOQ Item", PANEL, 1, OWNER);

  return raw;
};

const regenerate = async (raw) => {
  await executeRequirementProfile(envFor(raw), { itemId: PANEL, userId: OWNER });
  return currentRequirementProfile(d1(raw), PANEL);
};

const body = (profile) => JSON.parse(profile.profile_json || profile.profile || "{}");
const missingFields = (parsed) => (parsed.missingInformation || []).map((entry) => entry.field);

/* ------------------------------------------------------------------ *
 * 1. Vocabulary & version contract
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 1. vocabulary contract: classifications, authority, scopes, obligations, states, branches stay stable", () => {
  assert.equal(FIRE_ALARM_COMPLIANCE_EVIDENCE_POLICY_VERSION, "fire-alarm-compliance-evidence-policy-1.0.0");
  assert.deepEqual(Object.keys(MENTION_CLASSIFICATIONS).sort(), [
    "AMBIGUOUS", "INFORMATIVE_CONTEXT", "MANDATORY_PROJECT_REQUIREMENT", "MANUFACTURER_CAPABILITY", "PRODUCT_CERTIFICATION", "REFERENCE_STANDARD",
  ].sort());
  assert.deepEqual(Object.keys(AUTHORITY_CLASSES).sort(), [
    "APPROVED_ADDENDUM_OR_CLARIFICATION", "APPROVED_HUMAN_ENGINEERING_DECISION", "APPROVED_SYSTEM_SPECIFICATION", "BOQ_REQUIREMENT",
    "CONTRACTUAL_PROJECT_REQUIREMENT", "DRAWING_REQUIREMENT", "INFORMATIVE_TEXT", "MANUFACTURER_REFERENCE", "PRODUCT_REFERENCE",
  ].sort());
  assert.deepEqual(Object.keys(COMPLIANCE_SCOPES).sort(), [
    "DETECTORS", "FACP", "FIRE_ALARM_SYSTEM", "MODULES", "NOTIFICATION_APPLIANCES", "PRODUCT_ONLY", "PROJECT", "SPECIFIC_BOQ_ITEM", "SPECIFIC_BUILDING",
  ].sort());
  assert.deepEqual(Object.keys(COMPLIANCE_RESOLUTION_STATES).sort(), [
    "CONFLICTING_COMPLIANCE_EVIDENCE", "MISSING_COMPLIANCE_EVIDENCE", "REQUIRES_ENGINEERING_REVIEW", "RESOLVED_COMPLIANCE_FACTS",
  ].sort());
  assert.deepEqual(Object.keys(POLICY_BRANCHES).sort(), ["EN54_LPCB_POLICY_BRANCH", "NO_SUPPORTED_ECOSYSTEM_BRANCH", "UL_FM_POLICY_BRANCH"].sort());
});

/* ------------------------------------------------------------------ *
 * 2. Recognition: naming only, no authority implied
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 2. single-entry classification guards: negation is never a fact, unrecognized mandatory designations are ambiguous, ISO quality certs are capability only, manufacturing source never governs", () => {
  const mandated = classifyEvidenceEntry(spec("ul-mand", "UL", null, "The fire alarm system shall be listed under UL."));
  assert.equal(mandated.classification, MENTION_CLASSIFICATIONS.MANDATORY_PROJECT_REQUIREMENT);
  assert.equal(mandated.governing, true);
  assert.equal(mandated.scope, COMPLIANCE_SCOPES.FIRE_ALARM_SYSTEM);
  assert.equal(mandated.obligation, OBLIGATIONS.MANDATORY);

  const negated = classifyEvidenceEntry(spec("ul-neg", "UL", null, "Devices shall not be listed under UL."));
  assert.equal(negated.classification, MENTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(negated.governing, false);
  assert.equal(negated.basis, "NEGATED_RELATIONSHIP");

  const unrecognized = classifyEvidenceEntry(spec("x-mand", "XYZ-CERT", null, "The system shall comply with XYZ-CERT."));
  assert.equal(unrecognized.classification, MENTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(unrecognized.basis, "UNRECOGNIZED_DESIGNATION");
  assert.equal(unrecognized.governing, false);

  const iso = classifyEvidenceEntry(spec("iso9001", "ISO", "9001", "The manufacturer shall hold ISO 9001 certification."));
  assert.equal(iso.classification, MENTION_CLASSIFICATIONS.MANUFACTURER_CAPABILITY);
  assert.equal(iso.governing, false);

  const manufacturer = classifyEvidenceEntry(std({ id: "mfr-ul864", body: "UL", number: "864", originalText: "The panel is UL 864 listed.", sourceType: "Manufacturer Datasheet" }));
  assert.equal(manufacturer.classification, MENTION_CLASSIFICATIONS.MANUFACTURER_CAPABILITY);
  assert.equal(manufacturer.governing, false, "manufacturer material never governs");
});

test("GOLDEN-6B 2b. recognition names designations without implying authority or certification", () => {
  assert.deepEqual(recognizeStandardsConcept({ body: "UL" }), { concept: "UL", conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "UL" });
  assert.equal(recognizeStandardsConcept({ body: "UL", number: "217" }).concept, "UL 217");
  assert.equal(recognizeStandardsConcept({ body: "UL", number: "864" }).concept, "UL 864");
  assert.equal(recognizeStandardsConcept({ body: "FM" }).conceptType, CONCEPT_TYPES.CERTIFICATION);
  assert.equal(recognizeStandardsConcept({ body: "NFPA", number: "72" }).conceptType, CONCEPT_TYPES.STANDARD);
  assert.equal(recognizeStandardsConcept({ body: "NFPA", number: "70" }).concept, "NFPA 70");
  assert.equal(recognizeStandardsConcept({ body: "NFPA", number: "101" }).concept, "NFPA 101");
  assert.equal(recognizeStandardsConcept({ body: "EN54" }).conceptType, CONCEPT_TYPES.STANDARD);
  assert.equal(recognizeStandardsConcept({ body: "EN 54", number: "3" }).concept, "EN 54-3");
  assert.equal(recognizeStandardsConcept({ body: "LPCB" }).conceptType, CONCEPT_TYPES.APPROVAL_BODY);
  assert.equal(recognizeStandardsConcept({ body: "BS", number: "5839" }).concept, "BS 5839");
  assert.equal(recognizeStandardsConcept({ body: "European Standards" }).standardFamily, "European");
  // UNRECOGNIZED designations are null, never a fabricated role.
  assert.equal(recognizeStandardsConcept({ body: "XYZ" }), null);
  // NFPA codes are STANDARD by identity -- never convertible to certification.
  const nfpa = recognizeStandardsConcept({ body: "NFPA", number: "72" });
  assert.notEqual(nfpa.conceptType, CONCEPT_TYPES.CERTIFICATION);
});

/* ------------------------------------------------------------------ *
 * 3. Live-derived eligible evidence -> canonical facts (Layer B) + UL/FM adapter
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 3. current-project eligible evidence resolves to canonical facts and the UL/FM route (acceptance system-wide UL)", () => {
  const result = resolveComplianceEvidence({ entries: LIVE_ELIGIBLE_EVIDENCE() });
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS);

  // Canonical enforced scope+authority+currency+obligation on the UL facts.
  const ulFacts = result.facts.filter((f) => f.conceptType === CONCEPT_TYPES.CERTIFICATION);
  assert.ok(ulFacts.length >= 2, "UL certifications (system + detectors) present");
  const sysUl = result.certificationScopes.find((s) => s.certification === "UL");
  assert.equal(sysUl.scope, COMPLIANCE_SCOPES.FIRE_ALARM_SYSTEM);
  assert.equal(sysUl.authority, AUTHORITY_CLASSES.APPROVED_SYSTEM_SPECIFICATION);
  assert.equal(sysUl.obligation, OBLIGATIONS.MANDATORY);
  const detUl = result.certificationScopes.find((s) => s.certification === "UL 217");
  assert.equal(detUl.scope, COMPLIANCE_SCOPES.DETECTORS);
  assert.equal(detUl.classification, MENTION_CLASSIFICATIONS.PRODUCT_CERTIFICATION);

  // No synthetic equivalence, no fabricated FM, no fabricated LPCB.
  assert.deepEqual(result.requiredCertifications, ["UL"]);
  assert.deepEqual(result.requiredApprovals, []);
  assert.ok(!result.facts.some((f) => f.concept?.concept === "FM"), "FM must never be fabricated");
  assert.ok(result.applicableStandards.includes("NFPA"), "NFPA 72 family present");
  assert.ok(result.applicableStandards.includes("EN54"), "EN54 present as a standard (installation), not a certification regime");

  // Adapter: system-level UL establishes the UL/FM route; detector UL does not.
  const branch = deriveCompliancePolicyBranch(result);
  assert.equal(branch.policyBranch, POLICY_BRANCHES.UL_FM_POLICY_BRANCH);
  assert.equal(branch.regime, "UL/FM");
  assert.equal(branch.ruleId, "compliance-regime.ul-fm");
  assert.match(branch.reason, /UL/);
});

/* ------------------------------------------------------------------ *
 * 4. EN54 + LPCB -> EN54/LPCB route, GOLDEN-5 resolves Gent
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 4. EN54 + LPCB both established -> EN54_LPCB branch; GOLDEN-5 resolves Gent (Rule B)", () => {
  const resolution = resolveComplianceEvidence({ entries: LPCB_SYSTEM() });
  assert.equal(resolution.state, COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS);
  const adapter = deriveCompliancePolicyBranch(resolution);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.EN54_LPCB_POLICY_BRANCH);
  assert.equal(adapter.regime, "LPCB/EN54/European");
  assert.equal(adapter.ruleId, "compliance-regime.en54-lpcb");

  // GOLDEN-5 consumes ONLY the regime string; GOLDEN-6B never picks the ecosystem.
  const decision = resolveFireAlarmEcosystem({ complianceRegime: adapter.regime });
  assert.equal(decision.decisionState, "RESOLVED_GENT");
  assert.equal(decision.resolvedEcosystem, RESOLVED_ECOSYSTEM_TARGETS.GENT);
});

/* ------------------------------------------------------------------ *
 * 5. EN54-only fails closed (never GENT, no LPCB fabricated)
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 5. EN54-only -> NO_SUPPORTED branch, regime null; GOLDEN-5 reports MISSING, never Gent (§18/§23/§27 + negative)", () => {
  const result = resolveComplianceEvidence({
    entries: [spec("en54-1", "EN54", null, "The fire alarm system shall comply with EN54.")],
  });
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS);
  assert.deepEqual(result.requiredApprovals, [], "EN54-only must NOT fabricate LPCB");
  assert.deepEqual(result.requiredCertifications, [], "EN54 is a standard, not a certification");
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.NO_SUPPORTED_ECOSYSTEM_BRANCH);
  assert.equal(adapter.regime, null);

  const decision = resolveFireAlarmEcosystem({}); // no regime available
  assert.equal(decision.decisionState, "MISSING_FIRE_ALARM_COMPLIANCE_BASIS");
  assert.notEqual(decision.decisionState, "RESOLVED_GENT");
});

/* ------------------------------------------------------------------ *
 * 6. LPCB-only fails closed
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 6. LPCB-only -> NO_SUPPORTED branch, regime null (no EN54 fabricated)", () => {
  const result = resolveComplianceEvidence({
    entries: [std({ id: "lpcb-only", body: "LPCB", number: null, originalText: "The fire alarm system shall be approved by LPCB.", sourceType: "Technical Specification" })],
  });
  assert.deepEqual(result.requiredApprovals, ["LPCB"]);
  assert.ok(!result.applicableStandards.includes("EN54"), "LPCB-only must not fabricate EN54");
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.NO_SUPPORTED_ECOSYSTEM_BRANCH);
  assert.equal(adapter.regime, null);
  assert.match(adapter.reason, /LPCB/);
});

/* ------------------------------------------------------------------ *
 * 7. NFPA-only never becomes a certification regime
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 7. NFPA 72/70/101-only -> no regime; UL/FM never invented (negative)", () => {
  const result = resolveComplianceEvidence({
    entries: [
      spec("nfpa72", "NFPA", "72", "The fire alarm system shall be installed in accordance with NFPA 72."),
      spec("nfpa70", "NFPA", "70", "Electrical installation shall comply with NFPA 70 (NEC)."),
      spec("nfpa101", "NFPA", "101", "Life safety features shall follow NFPA 101."),
    ],
  });
  assert.deepEqual(result.requiredCertifications, []);
  assert.deepEqual(result.requiredApprovals, []);
  assert.deepEqual(result.applicableStandards, ["NFPA"]);
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.NO_SUPPORTED_ECOSYSTEM_BRANCH);
  assert.equal(adapter.regime, null);
  assert.match(adapter.reason, /Standards\/codes only/);
});

/* ------------------------------------------------------------------ *
 * 8. UL-only establishes the UL/FM route WITHOUT fabricating FM
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 8. UL-only -> UL_FM route, canonical facts keep ONLY UL (§16/§22 + negative)", () => {
  const result = resolveComplianceEvidence({
    entries: [spec("ul-only", "UL", null, "The fire alarm system shall be listed and approved by Underwriters Laboratories (UL).")],
  });
  assert.deepEqual(result.requiredCertifications, ["UL"]);
  assert.ok(!result.facts.some((f) => f.concept?.concept === "FM"), "UL-only must never persist FM");
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.UL_FM_POLICY_BRANCH);
  assert.equal(adapter.regime, "UL/FM");
});

/* ------------------------------------------------------------------ *
 * 9. Scope participation: detector-only UL is product-scoped, never a system route
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 9. detector-only UL -> PRODUCT_CERTIFICATION scoped DETECTORS, no system route (§16 scope participation)", () => {
  const result = resolveComplianceEvidence({
    entries: [
      spec("det-ul268", "UL", "268", "Smoke detectors must be UL certified to UL 268."),
      spec("det-ul217", "UL", "217", "Smoke detectors must be UL certified to UL 217."),
    ],
  });
  assert.deepEqual(result.requiredCertifications, ["UL"]);
  const scopes = result.certificationScopes.filter((s) => s.family === "UL").map((s) => s.scope);
  assert.ok(scopes.every((s) => s === COMPLIANCE_SCOPES.DETECTORS), "every UL fact is detector-scoped");
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.NO_SUPPORTED_ECOSYSTEM_BRANCH, "detector-only UL must not establish the system route");
  assert.equal(adapter.regime, null);
});

/* ------------------------------------------------------------------ *
 * 10. Mission §25: FACP UL + detector EN54 -> no conflict, system basis UL
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 10. FACP mandatory UL + detector EN54 -> no conflict; system compliance is UL-based, EN54 is product context", () => {
  const result = resolveComplianceEvidence({
    entries: [
      std({ id: "facp-ul", body: "UL", number: null, originalText: "The Fire Alarm Control Panel shall be listed under UL.", sourceType: "Technical Specification" }),
      std({ id: "det-en54", body: "EN54", number: null, originalText: "Detectors shall comply with EN54.", sourceType: "Technical Specification" }),
    ],
  });
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS);
  assert.deepEqual(result.conflicts, [], "field-device EN54 never conflicts with FACP UL");
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.UL_FM_POLICY_BRANCH, "FACP UL establishes the UL basis (§25)");
  assert.equal(adapter.regime, "UL/FM");
  const en54Facts = result.facts.filter((f) => f.concept?.concept === "EN 54");
  assert.ok(en54Facts.length && en54Facts[0].scope === COMPLIANCE_SCOPES.DETECTORS, "EN54 is product context, scoped to detectors");
});

/* ------------------------------------------------------------------ *
 * 11. System-wide UL + system-wide EN54/LPCB -> CONFLICT, fail closed
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 11. system-wide UL + system-wide EN54/LPCB -> CONFLICTING; counts/recency/vendor never break the tie (§24 + negative)", () => {
  const entries = [
    spec("ul-sys", "UL", null, "The fire alarm system shall be listed by UL."),
    spec("en54-sys-a", "EN54", null, "The fire alarm system shall comply with EN54."),
    spec("en54-sys-b", "EN54", "3", "The fire alarm system shall comply with EN54-3."),
    spec("en54-sys-c", "EN54", "4", "The fire alarm system shall comply with EN54-4."),
    std({ id: "lpcb-sys", body: "LPCB", number: null, originalText: "The fire alarm system shall be approved by LPCB.", sourceType: "Technical Specification" }),
  ];
  const result = resolveComplianceEvidence({ entries });
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.CONFLICTING_COMPLIANCE_EVIDENCE);
  assert.ok(result.conflicts.length > 0, "conflict surfaced");
  assert.ok(result.reviewPayload.conflictReason && /fails closed/.test(result.reviewPayload.conflictReason));

  // Three EN54 rows vs ONE UL row -- mention count does NOT select EN54.
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, null);
  assert.equal(adapter.regime, null);
  assert.equal(adapter.ruleId, null);
  assert.equal(adapter.reason, COMPLIANCE_RESOLUTION_STATES.CONFLICTING_COMPLIANCE_EVIDENCE);
});

/* ------------------------------------------------------------------ *
 * 12. Equal-authority supersession claims are INVALID -> stays conflicting
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 12. spec cannot supersede spec (equal authority) -> remains CONFLICTING, fails closed", () => {
  const result = resolveComplianceEvidence({
    entries: [
      std({ id: "ul-spec", body: "UL", number: null, originalText: "The fire alarm system shall be listed by UL.", sourceType: "Technical Specification", supersededBy: "lpcb-spec" }),
      std({ id: "lpcb-spec", body: "LPCB", number: null, originalText: "The fire alarm system shall be approved by LPCB.", sourceType: "Technical Specification" }),
    ],
  });
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.CONFLICTING_COMPLIANCE_EVIDENCE);
  assert.equal(deriveCompliancePolicyBranch(result).regime, null);
});

/* ------------------------------------------------------------------ *
 * 13. Higher-authority supersession: addendum overrides spec; old fact stays historical (§26/§34)
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 13. Addendum EN54/LPCB supersedes Specification UL -> EN54/LPCB route; UL stays in history, never deleted", () => {
  const result = resolveComplianceEvidence({
    entries: [
      std({ id: "ul-spec", body: "UL", number: null, originalText: "The fire alarm system shall be listed by UL.", sourceType: "Technical Specification", supersededBy: "en54-addendum" }),
      std({ id: "en54-addendum", body: "EN54", number: null, originalText: "Addendum: the fire alarm system shall comply with EN54.", sourceType: "Approved Addendum" }),
      std({ id: "lpcb-addendum", body: "LPCB", number: null, originalText: "Addendum: the fire alarm system shall be approved by LPCB.", sourceType: "Approved Addendum" }),
    ],
  });
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS);
  // UL survived as HISTORY, not as governing evidence and not deleted.
  assert.equal(result.supersededHistory.some((f) => f.id === "ul-spec"), true, "superseded UL is retained as history");
  assert.equal(result.facts.some((f) => f.id === "ul-spec"), true, "superseded UL still present in facts");
  assert.deepEqual(result.requiredCertifications, [], "superseded UL no longer governs");
  const adapter = deriveCompliancePolicyBranch(result);
  assert.equal(adapter.policyBranch, POLICY_BRANCHES.EN54_LPCB_POLICY_BRANCH);
  assert.equal(adapter.regime, "LPCB/EN54/European");
});

/* ------------------------------------------------------------------ *
 * 14. Manufacturer / vendor material is capability, never a mandate (negative)
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 14. manufacturer capability and vendor listings never become contractual requirements", () => {
  const result = resolveComplianceEvidence({
    entries: [
      std({ id: "mfr-ul", body: "UL", number: "268", originalText: "The detector is UL 268 listed and offers high resistance to nuisance alarms.", sourceType: "Manufacturer Datasheet" }),
      std({ id: "vendor-fm", body: "FM", number: null, originalText: "Available with FM approval for the control panel.", sourceType: "Approved Vendor List" }),
      std({ id: "mfr-en54", body: "EN54", number: "3", originalText: "This device complies with EN54-3 and supports 24V operation.", sourceType: "Manufacturer Datasheet" }),
    ],
  });
  for (const fact of result.facts) {
    assert.ok(
      fact.classification === MENTION_CLASSIFICATIONS.MANUFACTURER_CAPABILITY || fact.classification === MENTION_CLASSIFICATIONS.INFORMATIVE_CONTEXT,
      `capability classification for ${fact.id}`,
    );
    assert.equal(fact.governing, false, "manufacturer material never governs");
  }
  assert.deepEqual(result.requiredCertifications, []);
  assert.deepEqual(result.requiredApprovals, []);
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.MISSING_COMPLIANCE_EVIDENCE);
  assert.equal(deriveCompliancePolicyBranch(result).regime, null);
});

/* ------------------------------------------------------------------ *
 * 15. Ineligible rows are refused, never become evidence (negative + §31)
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 15. Pending Review / Draft / not-current / superseded-extraction rows are refused", () => {
  const result = resolveComplianceEvidence({
    entries: [
      std({ id: "pending", body: "UL", number: null, originalText: "The system shall be listed by UL.", sourceType: "Technical Specification", reviewStatus: "Pending Review" }),
      std({ id: "draft", body: "EN54", number: null, originalText: "The system shall comply with EN54.", sourceType: "Technical Specification", reviewStatus: "Draft", approvedForDownstream: 0 }),
      std({ id: "stale", body: "UL", number: null, originalText: "The system shall be listed by UL.", sourceType: "Technical Specification", current: false }),
    ],
  });
  assert.deepEqual(result.requiredCertifications, [], "no ineligible row may become a fact");
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.REQUIRES_ENGINEERING_REVIEW);
  const reviewIds = result.reviewPayload.reviews.map((r) => r.id);
  assert.ok(reviewIds.includes("pending") && reviewIds.includes("draft") && reviewIds.includes("stale"), "refused rows surfaced for review");
  assert.equal(deriveCompliancePolicyBranch(result).regime, null);
});

/* ------------------------------------------------------------------ *
 * 16. GOLDEN-5 integration boundary: adapter never selects an ecosystem/model
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 16. adapter returns ONLY regime strings; GOLDEN-5 alone resolves ecosystems; Frontier demo UL/FM -> Farenhyt", () => {
  const adapter = buildFireAlarmComplianceAdapterResult({ entries: LIVE_ELIGIBLE_EVIDENCE() });
  assert.deepEqual(
    Object.keys(adapter).filter((k) => /ecosystem|target|model/i.test(k)),
    [],
    "no ecosystem/target field on the adapter result",
  );
  // With the adapter's regime, GOLDEN-5 gates on governed sizing first.
  const noSizing = resolveFireAlarmEcosystem({ complianceRegime: adapter.regime });
  assert.equal(noSizing.decisionState, "PANEL_SIZING_SNAPSHOT_REQUIRED");
  // With governed sizing + complexity, GOLDEN-5 resolves Farenhyt itself.
  const resolved = resolveFireAlarmEcosystem({ complianceRegime: adapter.regime, preliminaryTotalPoints: 1500, complexity: "not-exceptional" });
  assert.equal(resolved.decisionState, "RESOLVED_FARENHYT");
  assert.equal(resolved.resolvedEcosystem, RESOLVED_ECOSYSTEM_TARGETS.FARENHYT);
});

/* ------------------------------------------------------------------ *
 * 17. Profile lifecycle (§33): governed standard evidence clears the blocker
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 17. profile lifecycle v1->v2: adding a governed requirement_standards child clears missingInformation.standard, moves the fingerprint, supersedes v1; rerun is idempotent (§33)", async () => {
  const raw = await seedProfileReplica();

  // v1: the linked Compliance requirement has NO requirement_standards child ->
  // the canonical standard input is empty -> `standard` is honestly reported
  // missing, and no standard is invented. Compatibility target stays missing.
  await executeRequirementProfile(envFor(raw), { itemId: PANEL, userId: OWNER });
  const v1 = await currentRequirementProfile(d1(raw), PANEL);
  assert.ok(v1, "v1 profile exists");
  assert.equal(v1.version_number, 1);
  const parsedV1 = body(v1);
  const missingV1 = missingFields(parsedV1);
  assert.ok(missingV1.includes("standard"), "standard must be reported missing without governed standard evidence");
  assert.ok(missingV1.includes("compatibilityTarget"), "compatibility target stays independent and missing");
  assert.deepEqual(parsedV1.standards || [], [], "no standard claimed");

  // v2: record ONE governed requirement_standards child row on the approved
  // eligible Compliance requirement -- the canonical Path A input.
  raw.prepare("INSERT INTO requirement_standards (id, requirement_id, body, number, part, year, original_text, status, confidence) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("std-ul864", REQ_COMPLIANCE, "UL", "864", null, null, "The fire alarm control panel shall be listed under UL 864.", "Mandatory", 94);

  const rerun = await regenerate(raw);
  assert.ok(rerun, "v2 profile exists");
  assert.equal(rerun.version_number, 2, "governed standard evidence bumps the version");
  assert.notEqual(rerun.input_fingerprint, v1.input_fingerprint, "fingerprint must move when the standard input changes");
  const parsedV2 = body(rerun);
  const missingV2 = missingFields(parsedV2);
  assert.ok(!missingV2.includes("standard"), "canonical standard evidence clears the standard blocker");
  assert.ok(missingV2.includes("compatibilityTarget"), "compatibilityTarget stays independent (still missing)");
  assert.ok((parsedV2.standards || []).some((s) => s.body === "UL"), "profile now carries the governed standard");

  // History: v1 kept, superseded, never mutated.
  const v1History = raw.prepare("SELECT * FROM requirement_profile_versions WHERE id=?").get(v1.id);
  assert.ok(v1History && v1History.superseded_at, "v1 retained as superseded history");

  // Idempotent no-change rerun: same fingerprint, same version, no new row.
  await executeRequirementProfile(envFor(raw), { itemId: PANEL, userId: OWNER });
  const v2Again = await currentRequirementProfile(d1(raw), PANEL);
  assert.equal(v2Again.id, rerun.id, "no-change rerun returns the same current profile");
  assert.equal(v2Again.version_number, 2, "no-change rerun does not mint v3");
  assert.equal(v2Again.input_fingerprint, rerun.input_fingerprint, "idempotency: fingerprint stable on no-change rerun");
});

/* ------------------------------------------------------------------ *
 * 18. §31/§32 honest dry-run posture: eligible requirement standards resolve;
 *     pending Source Facts are surfaced, never trusted (§31)
 * ------------------------------------------------------------------ */
test("GOLDEN-6B 18. pending applicable_standard Source Facts are refused and surfaced; eligible requirement standards still resolve (honest live posture)", () => {
  const result = resolveComplianceEvidence({
    entries: [
      ...LIVE_ELIGIBLE_EVIDENCE(),
      // Live snapshot: ALL 10 applicable_standard Source Facts are Pending Review.
      ...[
        ["heat-detector", "UL", "521"], ["duct-detector", "NFPA", null], ["sounder", "UL", null],
        ["conventional-detector", "UL", "268A"], ["control-module", "UL", "864"], ["facp", "UL", null],
        ["strobe", "NFPA", null], ["speaker-strobe", "BS", "6387"], ["manual-call-point", "NFPA", "72"], ["detector-base", "UL", null],
      ].map(([slug, body, number]) => ({
        id: `fact-${slug}`, kind: "applicable_standard_fact", body, number,
        originalText: `Product family ${slug} applicable standard (promoted Source Fact).`,
        sourceType: "Technical Specification", reviewStatus: "Pending Review",
      })),
    ],
  });
  // Requirement-standard evidence resolves; the 10 pending source facts are
  // NOT trusted and are surfaced in the review payload.
  assert.equal(result.state, COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS);
  assert.deepEqual(result.requiredCertifications, ["UL"]);
  assert.equal(result.reviewPayload.reviews.filter((r) => r.id.startsWith("fact-")).length, 10, "all pending Source Facts surfaced for review");
  assert.equal(deriveCompliancePolicyBranch(result).regime, "UL/FM");
});