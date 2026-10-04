/**
 * GOLDEN-5 -- the governed Fire Alarm ecosystem-selection policy.
 *
 * The policy (`app/domain/fire-alarm-ecosystem-policy.mjs`) decides WHICH
 * Fire Alarm panel/loop ecosystem a project is governed by, replacing the
 * assumption that "Honeywell / Notifier = the project-wide compatibility
 * basis". It resolves the ecosystem family from governed inputs only:
 * explicit project ecosystem (Rule A), compliance regime (Rule B), and the
 * UL/FM preliminary sizing route (Rule C: preliminary point count +
 * complexity evidence), then a governed large-system selection (Rule D).
 *
 * CANONICAL PERSISTENCE (GOLDEN-4 architecture reused): once the policy has
 * RESOLVED an ecosystem, the decision is recorded through the existing
 * governed lifecycle --
 *
 *   technical_requirements  (approved, policy-resolved)
 *     +-- requirement_compatibility (target_item = the ecosystem family)
 *     +-- boq_requirement_links    (status='Confirmed', one per applicable item)
 *
 * -- and PROFILE REGENERATION proves the fingerprint/version lifecycle that
 * GOLDEN-2/GOLDEN-4 established: new fingerprint, new profile version, prior
 * version retired, compatibilityTarget cleared. The exact panel model, loop
 * capacity, topology and expansion modules are NEVER selected here; the
 * policy performs PRELIMINARY ecosystem sizing only.
 *
 * HARD ASSERTIONS (also the negative guards):
 *   - FlashScan / CLIP protocol references are context ONLY and can never
 *     clear compatibilityTarget by themselves.
 *   - 2,000 is an INTERNAL engineering/business selection threshold, never a
 *     manufacturer-certified technical maximum.
 *   - A large UL/FM system (>2,000 points OR established exceptional
 *     complexity) never AUTO-selects between Gamewell-FCI and Simplex.
 *   - No compatibility target exists in any unresolved state; a
 *     requirement_compatibility row is written only AFTER resolution.
 *   - Readiness is not forced; unrelated missing information stays visible.
 *   - A resolved ecosystem produces no panel-model selection, no panel-sizing
 *     snapshot, no safety approval, no product approval, and no fabricated
 *     matching run.
 *   - Old matching runs are never re-pointed at regenerated profiles.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  FIRE_ALARM_ECOSYSTEM_POLICY_VERSION,
  FARENHYT_PRELIMINARY_POINT_THRESHOLD,
  FARENHYT_THRESHOLD_WORDING,
  ECOSYSTEM_DECISION_STATES,
  COMPLIANCE_REGIMES,
  RESOLVED_ECOSYSTEM_TARGETS,
  LARGE_ULFM_CANDIDATES,
  AUTHORITY_BASES,
  POLICY_RULES,
  normalizeComplianceRegime,
  normalizeComplexityEvidence,
  resolveFireAlarmEcosystem,
  ecosystemIsResolved,
} from "../app/domain/fire-alarm-ecosystem-policy.mjs";
import { loadInputs, executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { currentRequirementProfile } from "../worker/requirement-profile-currency.mjs";

const OWNER = "golden5-engineer";
const PROJECT = "golden5-project";
const PANEL_COUNT = 7;

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

/**
 * A Fire Alarm project with SEVEN Fire Alarm Control Panel BOQ items, shaped
 * like the acceptance project's seven-panel condition. The acceptance project
 * is read-only and is NOT touched by this suite; this fixture is a replica of
 * its SHAPE only. Six items carry no linked technical requirement at all and
 * one carries two unrelated requirements (item G's SLC-wiring and
 * network-topology rows) -- the exact condition GOLDEN-3 recorded, preserved
 * here rather than concealed.
 */
const seedProject = async ({ withResolution = false } = {}) => {
  const raw = await activeChain();
  const now = new Date().toISOString();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);

  run("INSERT INTO organizations (id,name) VALUES (?,?)", "org1", "GOLDEN-5 Org");
  run("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)",
    PROJECT, "GOLDEN-5 Seven-Panel Replica Project", OWNER, "org1", "Fire Alarm", "Active");
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
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, "sx1", "doc1", "dv1", 1, "Completed", "p1", "r1", "m1", "pr1", "o1", OWNER);
  run(`INSERT INTO specification_clauses (id,extraction_version_id,sequence,kind,path,original_text) VALUES (?,?,?,?,?,?)`,
    "cl1", "sx1", 1, "Requirement", "1", "System requirements");

  const panelItems = [];
  for (let i = 1; i <= PANEL_COUNT; i += 1) {
    const id = `panel-${i}`;
    run(`INSERT INTO boq_items
      (id,extraction_version_id,project_id,source_document_id,sequence,hierarchy_depth,section_path,row_type,item_number,description,system_value,category,
       normalized_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,
       approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, "bx1", PROJECT, "doc1", i, 0, "1", "Item", String(i), "Fire alarm control panel", "Fire Alarm", "Control Equipment", "EA", 1, 1,
      95, "High Confidence", "Approved", "{}", "{}", "{}", 1, now, now);
    panelItems.push(id);
  }

  let requirementSequence = 0;
  const requirement = (id, text, { reviewStatus = "Approved", approvedForDownstream = 1, extractionMethod = "engineering-policy-resolution", basis = "ENGINEERING_POLICY_RESOLUTION" } = {}) => {
    requirementSequence += 1;
    run(`INSERT INTO technical_requirements
      (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
       system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
       source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, "sx1", PROJECT, "doc1", "cl1", requirementSequence, text, text.toLowerCase(), "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment",
      "Mandatory", "Functional", 90, "High Confidence", reviewStatus, extractionMethod, "p1", "m1",
      JSON.stringify({ basis }), "{}", "{}", approvedForDownstream, now, now);
  };

  // Item G's two pre-existing requirements, neither of which names a panel.
  requirement("req-g-slc", "SLC wiring shall follow the project addressing convention.");
  requirement("req-g-net", "The control panel network topology shall be reviewed.");
  for (const panelId of panelItems.slice(0, 1)) {
    for (const requirementId of ["req-g-slc", "req-g-net"]) {
      run(`INSERT INTO boq_requirement_links
        (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        `link-${panelId}-${requirementId}`, PROJECT, panelId, requirementId, "Technical Review", 100, "[]", "Confirmed",
        "BOQ Item", panelId, 1, OWNER);
    }
  }

  if (withResolution) {
    // THE POLICY RESOLUTION, applied once. UL/FM regime + 1,500 preliminary
    // points + established not-exceptional complexity -> Honeywell Farenhyt.
    const decision = resolveFireAlarmEcosystem({
      complianceRegime: "UL/FM",
      preliminaryTotalPoints: 1500,
      complexity: "not-exceptional",
    });
    if (decision.decisionState !== "RESOLVED_FARENHYT") {
      throw new Error(`fixture resolution failed: ${decision.decisionState}`);
    }
    const basis = decision.basis;
    requirement("req-compat-ecosystem",
      "The Fire Alarm Control Panel and addressable-loop devices are resolved to the Honeywell Farenhyt Fire Alarm ecosystem "
      + `by the governed Fire Alarm ecosystem-selection policy (Rule C: UL/FM regime, 1,500 preliminary points, established not-exceptional complexity; policy version ${decision.version}; rule ${decision.ruleId}).`,
      { extractionMethod: "engineering-policy-resolution", basis });
    // The compatibility CHILD row is what detectMissingInformation consumes.
    run(`INSERT INTO requirement_compatibility
      (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status)
      VALUES (?,?,?,?,?,?,?,?)`,
      "rc-ecosystem", "req-compat-ecosystem", "Fire alarm control panel",
      decision.compatibilityTarget,
      "Compatible With", 1, 95, "Approved");
    // Provenance: the resolution is recorded as a governed Project Rule fact.
    run(`INSERT INTO engineering_facts
      (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,version_number,model_version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "fact-ecosystem-basis", PROJECT, "Project", PROJECT, "fire_alarm_ecosystem_basis",
      decision.resolvedEcosystem, "Text", "=", "Project Rule", "Project", PROJECT, "Active", 100, 1, "m1", now);
    // One decision, one child row, seven governed applicability links.
    for (const panelId of panelItems) {
      run(`INSERT INTO boq_requirement_links
        (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        `link-${panelId}-req-compat-ecosystem`, PROJECT, panelId, "req-compat-ecosystem", "Technical Review", 100,
        JSON.stringify([{ basis: "ENGINEERING_POLICY_RESOLUTION", policyVersion: decision.version, ruleId: decision.ruleId }]),
        "Confirmed", "BOQ Item", panelId, 1, OWNER);
    }
  }

  return { raw, panelItems };
};

const envFor = (raw) => ({
  DB: d1(raw),
  FILES: { get: async () => null, head: async () => null },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "golden5@test.invalid",
  APP_USER_NAME: "GOLDEN-5 Technical Manager",
  waitUntil: () => undefined,
});

const regenerate = async (raw, panelId) => {
  await executeRequirementProfile(envFor(raw), { itemId: panelId, userId: OWNER });
  return currentRequirementProfile(d1(raw), panelId);
};

const body = (profile) => JSON.parse(profile.profile_json || profile.profile || "{}");

/* ------------------------------------------------------------------ *
 * CONSTANTS AND DECISION-STATE CONTRACT
 * ------------------------------------------------------------------ */
test("GOLDEN-5 the policy exposes a versioned, honest decision contract", () => {
  assert.equal(FIRE_ALARM_ECOSYSTEM_POLICY_VERSION, "fire-alarm-ecosystem-policy-1.0.0");
  assert.equal(FARENHYT_PRELIMINARY_POINT_THRESHOLD, 2000);
  assert.match(FARENHYT_THRESHOLD_WORDING, /not a manufacturer-certified technical maximum/);
  assert.deepEqual(ECOSYSTEM_DECISION_STATES, [
    "EXPLICIT_PROJECT_ECOSYSTEM",
    "RESOLVED_FARENHYT",
    "RESOLVED_GENT",
    "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED",
    "MISSING_FIRE_ALARM_COMPLIANCE_BASIS",
    "PANEL_SIZING_SNAPSHOT_REQUIRED",
    "COMPLEXITY_REVIEW_REQUIRED",
  ]);
  assert.deepEqual(LARGE_ULFM_CANDIDATES, [
    "Honeywell Gamewell-FCI Fire Alarm ecosystem",
    "Simplex Fire Alarm ecosystem",
  ]);
  assert.deepEqual([...AUTHORITY_BASES].sort(), ["ENGINEERING_POLICY_RESOLUTION", "HUMAN_ENGINEERING_DECISION", "PROJECT_REQUIREMENT"]);
  // Every canonical target is a FAMILY string, never a model/SKU number.
  for (const target of Object.values(RESOLVED_ECOSYSTEM_TARGETS)) {
    assert.match(target, /Fire Alarm ecosystem$/);
    assert.doesNotMatch(target, /FACP|\b\d{3,}|HP-/i, `${target} must be a family, not an exact model`);
  }
});

/* ------------------------------------------------------------------ *
 * §13 ACCEPTANCE SCENARIOS (18) -- the policy, table-driven
 * ------------------------------------------------------------------ */
test("GOLDEN-5 §13 the eighteen acceptance scenarios resolve deterministically", () => {
  const cases = [
    {
      name: "1. UL/FM 1,500 points, not-exceptional complexity",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "not-exceptional" },
      state: "RESOLVED_FARENHYT", target: RESOLVED_ECOSYSTEM_TARGETS.FARENHYT, basis: "ENGINEERING_POLICY_RESOLUTION",
      rule: POLICY_RULES.FARENHYT,
    },
    {
      name: "2. UL/FM exactly 2,000 points (boundary inclusive), not-exceptional",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 2000, complexity: "not-exceptional" },
      state: "RESOLVED_FARENHYT", target: RESOLVED_ECOSYSTEM_TARGETS.FARENHYT, basis: "ENGINEERING_POLICY_RESOLUTION",
      rule: POLICY_RULES.FARENHYT,
    },
    {
      name: "3. UL/FM 2,001 points, not-exceptional",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 2001, complexity: "not-exceptional" },
      state: "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED", target: null, basis: null,
      rule: POLICY_RULES.LARGE_SYSTEM_EVALUATION, candidates: LARGE_ULFM_CANDIDATES, review: true,
    },
    {
      name: "4. UL/FM 1,500 points + established exceptional complexity",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "high" },
      state: "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED", target: null, basis: null,
      rule: POLICY_RULES.LARGE_SYSTEM_EVALUATION, candidates: LARGE_ULFM_CANDIDATES, review: true,
    },
    {
      name: "5. UL/FM 1,500 points + insufficient complexity evidence",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: null },
      state: "COMPLEXITY_REVIEW_REQUIRED", target: null, basis: null,
      rule: POLICY_RULES.COMPLEXITY_REVIEW, review: true,
    },
    {
      name: "6. UL/FM + preliminary point count missing",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: null, complexity: "not-exceptional" },
      state: "PANEL_SIZING_SNAPSHOT_REQUIRED", target: null, basis: null,
      rule: POLICY_RULES.SIZING_SNAPSHOT_REQUIRED, review: true,
    },
    {
      name: "7. compliance regime missing entirely",
      input: { complianceRegime: null, preliminaryTotalPoints: 1500 },
      state: "MISSING_FIRE_ALARM_COMPLIANCE_BASIS", target: null, basis: null,
      rule: POLICY_RULES.COMPLIANCE_REGIME_MISSING, review: true,
    },
    {
      name: "8. LPCB compliance regime",
      input: { complianceRegime: "LPCB/EN54/European" },
      state: "RESOLVED_GENT", target: RESOLVED_ECOSYSTEM_TARGETS.GENT, basis: "ENGINEERING_POLICY_RESOLUTION",
      rule: POLICY_RULES.COMPLIANCE_REGIME_GENT,
    },
    {
      name: "9. EN 54 raw evidence string normalizes to the European regime",
      input: { complianceRegime: "EN 54-2", preliminaryTotalPoints: 99999 },
      state: "RESOLVED_GENT", target: RESOLVED_ECOSYSTEM_TARGETS.GENT, basis: "ENGINEERING_POLICY_RESOLUTION",
      rule: POLICY_RULES.COMPLIANCE_REGIME_GENT,
    },
    {
      name: "10. European raw evidence string normalizes to the European regime",
      input: { complianceRegime: "European standard", preliminaryTotalPoints: 99999, complexity: "high" },
      state: "RESOLVED_GENT", target: RESOLVED_ECOSYSTEM_TARGETS.GENT, basis: "ENGINEERING_POLICY_RESOLUTION",
      rule: POLICY_RULES.COMPLIANCE_REGIME_GENT,
    },
    {
      name: "11. explicit project ecosystem wins (Rule A)",
      input: { explicitProjectEcosystem: "Simplex Fire Alarm ecosystem" },
      state: "EXPLICIT_PROJECT_ECOSYSTEM", target: "Simplex Fire Alarm ecosystem", basis: "PROJECT_REQUIREMENT",
      rule: POLICY_RULES.EXPLICIT_PROJECT_ECOSYSTEM,
    },
    {
      name: "12. explicit project ecosystem wins over contrary UL/FM defaults",
      input: { explicitProjectEcosystem: RESOLVED_ECOSYSTEM_TARGETS.GENT, complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "high" },
      state: "EXPLICIT_PROJECT_ECOSYSTEM", target: RESOLVED_ECOSYSTEM_TARGETS.GENT, basis: "PROJECT_REQUIREMENT",
      rule: POLICY_RULES.EXPLICIT_PROJECT_ECOSYSTEM,
    },
    {
      name: "13. approved large-system evaluation selects Gamewell-FCI",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional", approvedLargeSystemEcosystem: RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI },
      state: "EXPLICIT_PROJECT_ECOSYSTEM", target: RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI, basis: "HUMAN_ENGINEERING_DECISION",
      rule: POLICY_RULES.APPROVED_LARGE_SYSTEM_SELECTION,
    },
    {
      name: "14. approved large-system evaluation selects Simplex",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional", approvedLargeSystemEcosystem: RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX },
      state: "EXPLICIT_PROJECT_ECOSYSTEM", target: RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX, basis: "HUMAN_ENGINEERING_DECISION",
      rule: POLICY_RULES.APPROVED_LARGE_SYSTEM_SELECTION,
    },
    {
      name: "15. invalid large-system selection is refused (never an arbitrary pick)",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional", approvedLargeSystemEcosystem: "Siemens Cerberus Fire Alarm ecosystem" },
      state: "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED", target: null, basis: null,
      rule: POLICY_RULES.APPROVED_LARGE_SYSTEM_SELECTION, candidates: LARGE_ULFM_CANDIDATES, review: true,
    },
    {
      name: "16. FlashScan / CLIP alone never resolves an ecosystem",
      input: { protocolReferences: ["FlashScan / CLIP"] },
      state: "MISSING_FIRE_ALARM_COMPLIANCE_BASIS", target: null, basis: null,
      rule: POLICY_RULES.COMPLIANCE_REGIME_MISSING, review: true, protocolsIgnored: true,
    },
    {
      name: "17. FlashScan / CLIP is context alongside resolving evidence",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "not-exceptional", protocolReferences: ["FlashScan / CLIP"] },
      state: "RESOLVED_FARENHYT", target: RESOLVED_ECOSYSTEM_TARGETS.FARENHYT, basis: "ENGINEERING_POLICY_RESOLUTION",
      rule: POLICY_RULES.FARENHYT, protocolsIgnored: true,
    },
    {
      name: "18. a single input resolves a single canonical family",
      input: { complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "not-exceptional" },
      state: "RESOLVED_FARENHYT", target: RESOLVED_ECOSYSTEM_TARGETS.FARENHYT, basis: "ENGINEERING_POLICY_RESOLUTION",
      rule: POLICY_RULES.FARENHYT, resolvedCount: 1,
    },
  ];

  for (const scenario of cases) {
    const decision = resolveFireAlarmEcosystem(scenario.input);
    assert.equal(decision.decisionState, scenario.state, `${scenario.name}: decisionState`);
    assert.equal(decision.compatibilityTarget, scenario.target, `${scenario.name}: compatibilityTarget`);
    assert.equal(decision.resolvedEcosystem, scenario.target, `${scenario.name}: resolvedEcosystem`);
    assert.equal(decision.basis, scenario.basis, `${scenario.name}: basis`);
    assert.equal(decision.ruleId, scenario.rule, `${scenario.name}: ruleId`);
    assert.equal(decision.needsReview, Boolean(scenario.review), `${scenario.name}: needsReview`);
    assert.equal(decision.protocolReferencesIgnored, Boolean(scenario.protocolsIgnored), `${scenario.name}: protocolReferencesIgnored`);
    if (scenario.candidates) assert.deepEqual(decision.candidates, scenario.candidates, `${scenario.name}: candidates`);
    if (scenario.resolvedCount) {
      assert.equal(decision.resolvedEcosystem, decision.compatibilityTarget);
      assert.ok(decision.version.startsWith("fire-alarm-ecosystem-policy-1."));
    }
    // Unresolved states must NEVER carry a compatibility target.
    if (scenario.review) assert.equal(ecosystemIsResolved(decision), false, `${scenario.name}: unresolved states are not resolved`);
    else assert.equal(ecosystemIsResolved(decision), true, `${scenario.name}: resolved states are resolved`);
  }
});

/* ------------------------------------------------------------------ *
 * RULE A PRECEDENCE
 * ------------------------------------------------------------------ */
test("GOLDEN-5 Rule A: an explicit project ecosystem wins over every default", () => {
  const explicit = resolveFireAlarmEcosystem({
    explicitProjectEcosystem: RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX,
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: 2500,
    complexity: "high",
    protocolReferences: ["FlashScan / CLIP"],
  });
  assert.equal(explicit.decisionState, "EXPLICIT_PROJECT_ECOSYSTEM");
  assert.equal(explicit.compatibilityTarget, RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX);
  assert.equal(explicit.basis, "PROJECT_REQUIREMENT");
  assert.equal(explicit.ruleId, POLICY_RULES.EXPLICIT_PROJECT_ECOSYSTEM);
  // The project requirement is the ONLY authority that can carry a project-named
  // ecosystem; it does not go through sizing at all. The input trace records
  // the explicit ecosystem rather than the (contradictory) sizing evidence.
  assert.equal(explicit.inputsUsed.explicitProjectEcosystem, true);
  assert.equal(explicit.compatibilityTarget, RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX);
});

/* ------------------------------------------------------------------ *
 * COMPLIANCE-REGIME AND COMPLEXITY NORMALIZATION
 * ------------------------------------------------------------------ */
test("GOLDEN-5 compliance regime normalization fails closed on contradiction", () => {
  assert.equal(normalizeComplianceRegime("UL/FM"), COMPLIANCE_REGIMES.ULFM);
  assert.equal(normalizeComplianceRegime("UL 864 listed, FM approved"), COMPLIANCE_REGIMES.ULFM);
  assert.equal(normalizeComplianceRegime("LPCB approved"), COMPLIANCE_REGIMES.LPCB_EN54_EUROPEAN);
  assert.equal(normalizeComplianceRegime("EN 54-2 compliant"), COMPLIANCE_REGIMES.LPCB_EN54_EUROPEAN);
  assert.equal(normalizeComplianceRegime("European"), COMPLIANCE_REGIMES.LPCB_EN54_EUROPEAN);
  assert.equal(normalizeComplianceRegime(""), null);
  assert.equal(normalizeComplianceRegime("unclassified market standard"), null);
  // Contradictory regime evidence fails closed rather than guessing.
  assert.equal(normalizeComplianceRegime("UL 864 listed and EN 54 compliant"), null);
});

test("GOLDEN-5 complexity evidence normalization never guesses", () => {
  assert.equal(normalizeComplexityEvidence("high"), "high");
  assert.equal(normalizeComplexityEvidence("campus-wide voice evacuation"), "high");
  assert.equal(normalizeComplexityEvidence("smoke control and phased evacuation"), "high");
  assert.equal(normalizeComplexityEvidence("not-exceptional"), "not-exceptional");
  assert.equal(normalizeComplexityEvidence("small system, single building"), "not-exceptional");
  assert.equal(normalizeComplexityEvidence("standard occupancy"), "not-exceptional");
  assert.equal(normalizeComplexityEvidence(""), null);
  assert.equal(normalizeComplexityEvidence("unspecified"), null);
  // A statement asserting both extremes is contradictory -> insufficient.
  assert.equal(normalizeComplexityEvidence("small system, but with campus-wide voice evacuation"), null);
});

/* ------------------------------------------------------------------ *
 * §14 NEGATIVE ASSERTIONS (pure policy level)
 * ------------------------------------------------------------------ */
test("GOLDEN-5 §14 the 2,000 threshold is an internal selection threshold, never a certified maximum", () => {
  const decision = resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "not-exceptional" });
  assert.equal(decision.thresholdIsCertifiedMaximum, false);
  assert.equal(decision.threshold, 2000);
  assert.match(decision.reason, /internal engineering\/business selection threshold/);
  assert.doesNotMatch(decision.reason, /certified (technical )?maximum for|listed (up to|for)|rated (up to|for)/i,
    "the reason must never claim a certified technical maximum");
  const large = resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional" });
  assert.match(large.reason, /not a manufacturer-certified technical maximum/);
});

test("GOLDEN-5 §14 the policy never auto-selects between Gamewell-FCI and Simplex", () => {
  const decision = resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional" });
  assert.equal(decision.decisionState, "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED");
  assert.equal(decision.compatibilityTarget, null);
  assert.deepEqual(decision.candidates, LARGE_ULFM_CANDIDATES);
  // The candidates surface for governed evaluation; nothing resolves until an
  // approved selection of EXACTLY ONE candidate is supplied.
  const refused = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional",
    approvedLargeSystemEcosystem: "Honeywell Farenhyt Fire Alarm ecosystem",
  });
  assert.equal(refused.compatibilityTarget, null, "a small-system family cannot be injected into the large evaluation");
});

test("GOLDEN-5 §14 large-branch before approval carries no compatibility target in any unresolved state", () => {
  for (const input of [
    { complianceRegime: null },
    { complianceRegime: "UL/FM", preliminaryTotalPoints: null },
    { complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: null },
    { complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional" },
    { protocolReferences: ["CLIP"] },
  ]) {
    const decision = resolveFireAlarmEcosystem(input);
    assert.equal(decision.compatibilityTarget, null, JSON.stringify(input));
    assert.equal(ecosystemIsResolved(decision), false, `unresolved: ${decision.decisionState}`);
  }
});

/* ------------------------------------------------------------------ *
 * §15 THE CANONICAL LIFECYCLE, DRIVEN BY A POLICY-RESOLVED ECOSYSTEM
 * ------------------------------------------------------------------ */
test("GOLDEN-5 §15 1. with no resolution the compatibilityTarget blocker is real on all seven items", async () => {
  const { raw, panelItems } = await seedProject();
  for (const panelId of panelItems) {
    const profile = await regenerate(raw, panelId);
    const parsed = body(profile);
    const missing = (parsed.missingInformation || []).map((entry) => entry.field);
    assert.ok(missing.includes("compatibilityTarget"),
      `${panelId} must report compatibilityTarget as missing, got ${JSON.stringify(missing)}`);
    assert.ok((parsed.compatibility || []).length === 0, `${panelId} must carry no compatibility relationship`);
    assert.equal(profile.readiness_status, "Missing Critical Information", `${panelId} readiness must be blocked`);
  }
});

test("GOLDEN-5 §15 2-6. the policy resolution creates canonical, provable evidence with policy provenance", async () => {
  const { raw, panelItems } = await seedProject({ withResolution: true });

  const resolution = resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "not-exceptional" });
  const requirement = raw.prepare("SELECT * FROM technical_requirements WHERE id='req-compat-ecosystem'").get();
  assert.equal(requirement.review_status, "Approved", "the resolved requirement is approved");
  assert.equal(requirement.approved_for_downstream, 1);
  // The authority is the governed policy resolution, never a manufactured
  // specification clause and never a protocol reference.
  assert.equal(JSON.parse(requirement.source_location).basis, "ENGINEERING_POLICY_RESOLUTION");
  assert.equal(requirement.extraction_method, "engineering-policy-resolution");
  assert.doesNotMatch(requirement.original_text, /specification mandates|shall be manufactured|must be specifically|FlashScan/i,
    "the requirement must not invent a Specification clause or use protocol context as authority");
  assert.match(requirement.original_text, /governed Fire Alarm ecosystem-selection policy/);

  const compat = raw.prepare("SELECT * FROM requirement_compatibility WHERE requirement_id='req-compat-ecosystem'").get();
  assert.ok(compat, "a requirement_compatibility child row is the canonical evidence");
  assert.equal(compat.target_item, resolution.compatibilityTarget, "the ecosystem family is the target");
  assert.equal(compat.target_item, RESOLVED_ECOSYSTEM_TARGETS.FARENHYT);
  assert.equal(compat.review_status, "Approved");
  assert.doesNotMatch(compat.target_item, /\b[A-Z]{2,}-\d{3,}\b/, "no model number may be implied");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_manufacturers WHERE requirement_id='req-compat-ecosystem'").get().c, 0,
    "the decision is a compatibility relationship, NOT a manufacturer assignment");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_standards WHERE requirement_id='req-compat-ecosystem'").get().c, 0,
    "no standard is manufactured by the decision");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_attributes WHERE requirement_id='req-compat-ecosystem'").get().c, 0,
    "no structured attribute is manufactured by the decision");

  // Policy provenance is a governed Project Rule fact, not a derived inference.
  const fact = raw.prepare("SELECT * FROM engineering_facts WHERE id='fact-ecosystem-basis'").get();
  assert.equal(fact.fact_type, "Project Rule");
  assert.equal(fact.scope_type, "Project");
  assert.equal(fact.predicate, "fire_alarm_ecosystem_basis");
  assert.equal(fact.value, RESOLVED_ECOSYSTEM_TARGETS.FARENHYT);
  assert.equal(fact.status, "Active");

  // One decision, ONE child row, SEVEN governed links: the resolution is
  // recorded once and propagated by the existing applicability mechanism.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM technical_requirements WHERE id='req-compat-ecosystem'").get().c, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_compatibility WHERE requirement_id='req-compat-ecosystem'").get().c, 1);
  const links = raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE requirement_id='req-compat-ecosystem' AND status='Confirmed'").get().c;
  assert.equal(links, PANEL_COUNT, "one governed resolution reaches all seven items");

  for (const panelId of panelItems) {
    const link = raw.prepare("SELECT * FROM boq_requirement_links WHERE requirement_id='req-compat-ecosystem' AND boq_item_id=?").get(panelId);
    assert.equal(link.status, "Confirmed", `${panelId} link is Confirmed, which is what the engine reads as Confirmed Applicable`);
    assert.equal(link.created_by, OWNER, "the acting engineer is recorded");
  }
});

test("GOLDEN-5 §15 7-9. the policy resolution changes the fingerprint, retires the prior version, and clears the blocker", async () => {
  // ONE continuous lifecycle on ONE database: generate, resolve, regenerate.
  const { raw, panelItems } = await seedProject();

  const before = {};
  for (const panelId of panelItems) before[panelId] = await regenerate(raw, panelId);

  // The policy resolution arrives and is recorded once, then linked.
  const decision = resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "not-exceptional" });
  assert.equal(decision.decisionState, "RESOLVED_FARENHYT");
  const now = new Date().toISOString();
  const trace = JSON.stringify({ basis: "ENGINEERING_POLICY_RESOLUTION", policyVersion: decision.version, ruleId: decision.ruleId, inputs: decision.inputsUsed });
  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "req-compat-ecosystem", "sx1", PROJECT, "doc1", "cl1", 50,
    `The Fire Alarm Control Panel is resolved to the honeywell farenhyt ecosystem by the governed Fire Alarm ecosystem-selection policy (Rule C, ${decision.version}).`,
    "honeywell farenhyt", "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment", "Mandatory", "Functional", 95,
    "High Confidence", "Approved", "engineering-policy-resolution", "p1", "m1",
    trace, "{}", "{}", 1, now, now);
  raw.prepare(`INSERT INTO requirement_compatibility
    (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status) VALUES (?,?,?,?,?,?,?,?)`)
    .run("rc-ecosystem", "req-compat-ecosystem", "Fire alarm control panel",
      decision.compatibilityTarget, "Compatible With", 1, 95, "Approved");
  for (const panelId of panelItems) {
    raw.prepare(`INSERT INTO boq_requirement_links
      (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`link-${panelId}-req-compat-ecosystem`, PROJECT, panelId, "req-compat-ecosystem", "Technical Review", 100, "[]",
        "Confirmed", "BOQ Item", panelId, 1, OWNER);
  }

  for (const panelId of panelItems) {
    const priorVersion = before[panelId].version_number;
    const priorFingerprint = before[panelId].input_fingerprint;
    const current = await regenerate(raw, panelId);
    const parsed = body(current);

    assert.notEqual(current.input_fingerprint, priorFingerprint, `${panelId} input fingerprint must change`);
    assert.ok(current.version_number > priorVersion, `${panelId} must gain a new profile version`);
    const prior = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND version_number=?").get(panelId, priorVersion);
    assert.ok(prior.superseded_at, `${panelId} prior profile version must become non-current`);
    assert.equal(current.superseded_at, null, `${panelId} new profile is the current one`);

    const missing = (parsed.missingInformation || []).map((entry) => entry.field);
    assert.ok(!missing.includes("compatibilityTarget"), `${panelId} compatibilityTarget must be satisfied, still missing ${JSON.stringify(missing)}`);
    const compatibility = parsed.compatibility || [];
    assert.ok(compatibility.some((entry) => /Honeywell Farenhyt/.test(entry.targetItem || "")),
      `${panelId} compatibility must carry the policy-resolved Honeywell Farenhyt target`);
  }
});

test("GOLDEN-5 §15 10. readiness is not forced; unrelated blockers remain visible", async () => {
  const { raw, panelItems } = await seedProject({ withResolution: true });
  const parsed = body(await regenerate(raw, panelItems[0]));
  const missing = (parsed.missingInformation || []).map((entry) => entry.field);
  assert.ok(!missing.includes("compatibilityTarget"), "compatibilityTarget specifically is satisfied");
  assert.ok(missing.length > 0, `other missing fields must remain reported, got ${JSON.stringify(missing)}`);
  for (const field of missing) assert.notEqual(field, "compatibilityTarget");
  const profile = await currentRequirementProfile(d1(raw), panelItems[0]);
  assert.notEqual(profile.readiness_status, "Ready for Matching", "this slice must not force full readiness");
});

test("GOLDEN-5 §15 14. the resolution selects no panel model, loop capacity, topology or expansion module", async () => {
  const { raw, panelItems } = await seedProject({ withResolution: true });
  const parsed = body(await regenerate(raw, panelItems[0]));
  for (const attribute of parsed.consolidatedRequirements?.flatMap((r) => r.attributes || []) || []) {
    assert.doesNotMatch(attribute.name || "", /model|loop capacity|network topology|expansion/i,
      "the resolution must not manufacture the deferred panel-sizing inputs");
  }
  const compatibility = parsed.compatibility || [];
  for (const entry of compatibility) {
    assert.doesNotMatch(entry.targetItem || "", /\b(FACP|HP-|Notifier-[A-Z]?\d)/i,
      "no exact FACP model may be named by the compatibility boundary");
  }
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM fire_alarm_panel_sizing_snapshots").get().c, 0,
    "the ecosystem resolution must not create a panel-sizing snapshot (preliminary sizing is a separate stage)");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0, "no safety approval may be created");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_decisions").get().c, 0, "no safety decision may be created");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_match_runs").get().c, 0, "no matching run is fabricated by this slice");
});

/* ------------------------------------------------------------------ *
 * SUPERSESSION VIA THE ORDINARY GOVERNED LIFECYCLE
 * ------------------------------------------------------------------ */
test("GOLDEN-5 a later policy-resolved ecosystem supersedes the basis; old runs are never re-pointed", async () => {
  const { raw, panelItems } = await seedProject({ withResolution: true });
  await regenerate(raw, panelItems[0]);
  const first = body(await currentRequirementProfile(d1(raw), panelItems[0]));
  assert.ok(first.compatibility.some((entry) => /Honeywell Farenhyt/.test(entry.targetItem || "")));

  // Bind a pre-existing Discovery Only run to the CURRENT profile.
  const profile = await currentRequirementProfile(d1(raw), panelItems[0]);
  const now = new Date().toISOString();
  raw.prepare(`INSERT INTO product_match_runs
    (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,candidate_count,created_by,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "old-discovery-run", PROJECT, panelItems[0], profile.id, 1, "Discovery Only", "old-fp", "e1", "r1", "s1", "m1",
    "Project", "{}", 0, OWNER, now, now);

  // A later policy resolution (European regime) supersedes the Farenhyt basis.
  const later = resolveFireAlarmEcosystem({ complianceRegime: "LPCB/EN54/European" });
  assert.equal(later.decisionState, "RESOLVED_GENT");
  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "req-compat-later", "sx1", PROJECT, "doc1", "cl1", 99,
    `The Fire Alarm Control Panel is resolved to the gent ecosystem by the governed Fire Alarm ecosystem-selection policy (Rule B, ${later.version}).`,
    "gent", "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment", "Mandatory", "Functional", 95,
    "High Confidence", "Approved", "engineering-policy-resolution", "p1", "m1",
    JSON.stringify({ basis: "ENGINEERING_POLICY_RESOLUTION", policyVersion: later.version, ruleId: later.ruleId, supersedes: "req-compat-ecosystem" }), "{}", "{}", 1, now, now);
  raw.prepare(`INSERT INTO requirement_compatibility
    (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status) VALUES (?,?,?,?,?,?,?,?)`)
    .run("rc-later", "req-compat-later", "Fire alarm control panel", later.compatibilityTarget,
      "Compatible With", 1, 95, "Approved");
  for (const panelId of panelItems) {
    raw.prepare(`INSERT INTO boq_requirement_links
      (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`link-${panelId}-req-compat-later`, PROJECT, panelId, "req-compat-later", "Technical Review", 100, "[]", "Confirmed", "BOQ Item", panelId, 1, OWNER);
  }

  const refreshed = await regenerate(raw, panelItems[0]);
  const after = body(refreshed);
  const targets = (after.compatibility || []).map((entry) => entry.targetItem || "");
  assert.ok(targets.some((t) => /Gent by Honeywell/.test(t)), "the later policy-resolved basis is present");
  // Historical evidence is never mutated: the earlier Farenhyt requirement row
  // still names Farenhyt and is superseded through the governed lifecycle.
  const earlierRow = raw.prepare("SELECT target_item FROM requirement_compatibility WHERE requirement_id='req-compat-ecosystem'").get();
  assert.equal(earlierRow.target_item, RESOLVED_ECOSYSTEM_TARGETS.FARENHYT, "historical compatibility rows are never rewritten");

  // The old run is still bound to the profile it was created against.
  const oldRun = raw.prepare("SELECT * FROM product_match_runs WHERE id='old-discovery-run'").get();
  assert.equal(oldRun.requirement_profile_version_id, profile.id, "the old run is not re-pointed at the regenerated profile");
  const oldProfile = raw.prepare("SELECT * FROM requirement_profile_versions WHERE id=?").get(profile.id);
  assert.ok(oldProfile.superseded_at, "the profile the old run referenced is now non-current");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_match_runs").get().c, 1, "no new match run is fabricated");
  assert.ok(refreshed.input_fingerprint !== profile.input_fingerprint, "the fingerprint moved with the new resolution");
  assert.ok(refreshed.version_number > profile.version_number, "a new profile version exists");
});

/* ------------------------------------------------------------------ *
 * §16 SEVEN-FACP SINGLE-DECISION PROPAGATION
 * ------------------------------------------------------------------ */
test("GOLDEN-5 §16 one policy resolution reaches all seven control-panel items through profile input", async () => {
  const { raw, panelItems } = await seedProject({ withResolution: true });
  assert.equal(panelItems.length, PANEL_COUNT);
  const matrix = [];
  for (const panelId of panelItems) {
    const inputs = await loadInputs(d1(raw), { id: panelId, project_id: PROJECT });
    const decisionReached = (inputs.requirements || []).some((r) => r.id === "req-compat-ecosystem");
    const compatRows = raw.prepare("SELECT COUNT(*) c FROM requirement_compatibility WHERE requirement_id='req-compat-ecosystem'").get().c;
    const profile = await regenerate(raw, panelId);
    const parsed = body(profile);
    const missing = (parsed.missingInformation || []).map((e) => e.field);
    matrix.push({
      panelId,
      decisionReachedProfileInput: decisionReached,
      compatibilityChildRows: compatRows,
      profileVersion: profile.version_number,
      fingerprint: profile.input_fingerprint.slice(0, 12),
      compatibilityTargetSatisfied: !missing.includes("compatibilityTarget"),
      otherBlockers: missing.filter((f) => f !== "compatibilityTarget"),
    });
  }
  for (const row of matrix) {
    assert.equal(row.decisionReachedProfileInput, true, `${row.panelId} must receive the resolution through loadInputs`);
    assert.equal(row.compatibilityTargetSatisfied, true, `${row.panelId} compatibilityTarget must be satisfied`);
  }
  // ONE decision reachable by all seven items via the canonical requirement --
  // the decision is never duplicated seven times.
  assert.equal(new Set(matrix.map((r) => r.compatibilityChildRows)).size, 1);
  assert.equal(matrix[0].compatibilityChildRows, 1, "exactly one requirement_compatibility child row for the whole project");

  // Item G additionally retains its two pre-existing requirements; the six
  // others carry ONLY the ecosystem resolution. That asymmetry is GOLDEN-3's
  // finding and is preserved rather than concealed.
  const gRequirements = raw.prepare(`SELECT COUNT(*) c FROM boq_requirement_links l
    JOIN technical_requirements r ON r.id=l.requirement_id
    WHERE l.boq_item_id=? AND l.status='Confirmed' AND r.approved_for_downstream=1`).get(panelItems[0]).c;
  const otherRequirements = raw.prepare(`SELECT COUNT(*) c FROM boq_requirement_links l
    JOIN technical_requirements r ON r.id=l.requirement_id
    WHERE l.boq_item_id=? AND l.status='Confirmed' AND r.approved_for_downstream=1`).get(panelItems[1]).c;
  assert.equal(gRequirements, 3, "item G keeps its 2 original requirements plus the ecosystem resolution");
  assert.equal(otherRequirements, 1, "the other six carry only the ecosystem resolution -- their missing requirement linkage is NOT concealed");
  assert.ok(matrix.every((row) => row.otherBlockers.length >= 0));
});

/* ------------------------------------------------------------------ *
 * §14 NEGATIVE ASSERTIONS (engine / persistence level)
 * ------------------------------------------------------------------ */
test("GOLDEN-5 §14 FlashScan / CLIP protocol reference alone never clears compatibilityTarget", async () => {
  const { raw, panelItems } = await seedProject();
  raw.prepare("UPDATE boq_items SET current_values=? WHERE id=?").run(
    JSON.stringify({ protocol_reference: "FlashScan / CLIP" }), panelItems[0]);
  const parsed = body(await regenerate(raw, panelItems[0]));
  const missing = (parsed.missingInformation || []).map((entry) => entry.field);
  assert.ok(missing.includes("compatibilityTarget"),
    "FlashScan / CLIP alone must not clear compatibilityTarget");
  assert.ok((parsed.compatibility || []).length === 0, "no compatibility relationship may be derived from a protocol reference");
});

test("GOLDEN-5 §14 a LARGE evaluation with no approval writes no compatibility row and leaves the target missing", async () => {
  // Policy says: >2,000 points -> evaluation required, no target until approval.
  const decision = resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 2500, complexity: "not-exceptional" });
  assert.equal(decision.decisionState, "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED");
  assert.equal(decision.compatibilityTarget, null);

  const { raw, panelItems } = await seedProject();
  const now = new Date().toISOString();
  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "req-compat-large", "sx1", PROJECT, "doc1", "cl1", 50,
    "Large UL/FM system: governed ecosystem evaluation required; candidates Gamewell-FCI and Simplex.",
    "large ulfm evaluation", "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment", "Mandatory", "Functional", 95,
    "High Confidence", "Approved", "engineering-policy-resolution", "p1", "m1",
    JSON.stringify({ basis: "ENGINEERING_POLICY_RESOLUTION", inputPoints: 2500 }), "{}", "{}", 1, now, now);
  // NO requirement_compatibility child row is written, because nothing resolved.
  for (const panelId of panelItems) {
    raw.prepare(`INSERT INTO boq_requirement_links
      (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`link-${panelId}-req-compat-large`, PROJECT, panelId, "req-compat-large", "Technical Review", 100, "[]", "Confirmed", "BOQ Item", panelId, 1, OWNER);
  }
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_compatibility WHERE requirement_id='req-compat-large'").get().c, 0);
  const parsed = body(await regenerate(raw, panelItems[0]));
  const missing = (parsed.missingInformation || []).map((e) => e.field);
  assert.ok(missing.includes("compatibilityTarget"), "a large-UL/FM evaluation with no approval must leave compatibilityTarget missing");
});

test("GOLDEN-5 §14 the requirement engine contains no manufacturer-specific authority", async () => {
  const source = await readFile(new URL("../app/domain/technical-requirement-engine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Honeywell/i, "Honeywell must not be hardcoded in the matching/requirement engine");
  assert.doesNotMatch(source, /Notifier/i, "Notifier must not be hardcoded in the matching/requirement engine");
  assert.doesNotMatch(source, /Farenhyt|Gent|Gamewell|Simplex/i,
    "no ecosystem-family vocabulary may be hardcoded in the matching/requirement engine; the policy module owns that vocabulary");
});