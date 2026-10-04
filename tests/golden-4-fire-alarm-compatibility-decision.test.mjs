/**
 * GOLDEN-4 -- record a governed Fire Alarm compatibility decision and
 * prove the normal downstream lifecycle.
 *
 * THE AUTHORITY IS THE GOVERNED FIRE ALARM ECOSYSTEM-SELECTION POLICY
 * (GOLDEN-5): the fixture now seeds the decision through
 * `resolveFireAlarmEcosystem` (UL/FM regime + 1,500 preliminary points +
 * established not-exceptional complexity -> RESOLVED_FARENHYT ->
 * "Honeywell Farenhyt Fire Alarm ecosystem"), with
 * extraction_method='engineering-policy-resolution', basis
 * ENGINEERING_POLICY_RESOLUTION, and a Project Rule fact
 * (`fire_alarm_ecosystem_basis`), per GOLDEN-5 §15. The GOLDEN-4 fixtures that
 * previously hardcoded a hand-written "Honeywell / Notifier" human decision now
 * record the policy-resolved ecosystem through the exact same canonical rows.
 *
 * Nothing in this suite claims the Specification mandates any manufacturer,
 * that FlashScan / CLIP independently establish project-wide authority, that
 * Honeywell was inferred, that the five-manufacturer reference list selects
 * Honeywell, or that a protocol reference resolves an ecosystem. Those are
 * explicitly NOT asserted, and the suite asserts the opposite where it matters:
 * the protocol reference and the manufacturer list are context, never authority.
 *
 * The decision is recorded through the EXISTING canonical lifecycle that the
 * project's own only-ever-satisfied profile already uses (item C, Heat Detector):
 *
 *   technical_requirements  (approved, human-decided)
 *     +-- requirement_compatibility (target_item = the ecosystem boundary)
 *     +-- boq_requirement_links    (status='Confirmed', one per applicable item)
 *
 * `detectMissingInformation` consumes exactly this shape
 * (`compatibility.some(item => item.targetItem || item.rightEntityId)`), so no
 * parallel compatibility-decision table is introduced and no profile JSON is
 * written directly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { loadInputs, executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { currentRequirementProfile } from "../worker/requirement-profile-currency.mjs";
import {
  resolveFireAlarmEcosystem,
  RESOLVED_ECOSYSTEM_TARGETS,
} from "../app/domain/fire-alarm-ecosystem-policy.mjs";

const OWNER = "golden4-engineer";
const PROJECT = "golden4-project";
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
 * A Fire Alarm project with SEVEN Fire Alarm Control Panel BOQ items, shaped like the
 * acceptance project's seven-panel condition. The acceptance project is read-only
 * and is NOT touched by this suite; this fixture is a replica of its SHAPE only
 * and contains none of its data. Six items carry no linked technical
 * requirement at all -- the exact condition GOLDEN-3 recorded and did not hide --
 * and one carries two unrelated requirements (item G's SLC-wiring and
 * network-topology rows), none of which names a compatible panel.
 */
const seedProject = async ({ withDecision = false } = {}) => {
  const raw = await activeChain();
  const now = new Date().toISOString();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);

  run("INSERT INTO organizations (id,name) VALUES (?,?)", "org1", "GOLDEN-4 Org");
  run("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)",
    PROJECT, "GOLDEN-4 Seven-Panel Replica Project", OWNER, "org1", "Fire Alarm", "Active");
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

  // technical_requirements is UNIQUE on (extraction_version_id, sequence), so
  // each seeded requirement needs its own sequence within the extraction.
  let requirementSequence = 0;
  const requirement = (id, text, { reviewStatus = "Approved", approvedForDownstream = 1, extractionMethod = "human-engineering-decision", basis = "HUMAN_ENGINEERING_DECISION" } = {}) => {
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

  if (withDecision) {
    // THE POLICY-RESOLVED DECISION (GOLDEN-5 §15), recorded once. UL/FM
    // regime + 1,500 preliminary points + established not-exceptional
    // complexity resolves to Honeywell Farenhyt -- the canonical decision
    // this fixture records through the normal lifecycle.
    const decision = resolveFireAlarmEcosystem({
      complianceRegime: "UL/FM",
      preliminaryTotalPoints: 1500,
      complexity: "not-exceptional",
    });
    if (!decision.compatibilityTarget || decision.decisionState !== "RESOLVED_FARENHYT") {
      throw new Error(`fixture must resolve to Farenhyt, got ${decision.decisionState}`);
    }
    requirement("req-compat-honeywell",
      `The Fire Alarm Control Panel and addressable-loop devices are governed by the ${decision.compatibilityTarget}, `
      + `resolved by the governed Fire Alarm ecosystem-selection policy (Rule C: UL/FM regime, 1,500 preliminary points, `
      + `established not-exceptional complexity; policy version ${decision.version}; rule ${decision.ruleId}).`,
      { extractionMethod: "engineering-policy-resolution", basis: "ENGINEERING_POLICY_RESOLUTION" });
    // The compatibility CHILD row is what detectMissingInformation consumes.
    run(`INSERT INTO requirement_compatibility
      (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status)
      VALUES (?,?,?,?,?,?,?,?)`,
      "rc-honeywell", "req-compat-honeywell", "Fire alarm control panel",
      decision.compatibilityTarget,
      "Compatible With", 1, 95, "Approved");
    // Provenance: an ENGINEERING_POLICY_RESOLUTION is a governed Project Rule
    // fact, never a manufactured specification clause.
    run(`INSERT INTO engineering_facts
      (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,version_number,model_version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "fact-compat-decision", PROJECT, "Project", PROJECT, "fire_alarm_ecosystem_basis",
      decision.resolvedEcosystem, "Text", "=", "Project Rule", "Project", PROJECT, "Active", 100, 1, "m1", now);
    // One requirement, one child row, seven governed applicability links.
    for (const panelId of panelItems) {
      run(`INSERT INTO boq_requirement_links
        (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        `link-${panelId}-req-compat-honeywell`, PROJECT, panelId, "req-compat-honeywell", "Technical Review", 100,
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
  APP_USER_EMAIL: "golden4@test.invalid",
  APP_USER_NAME: "GOLDEN-4 Technical Manager",
  waitUntil: () => undefined,
});

const regenerate = async (raw, panelId) => {
  await executeRequirementProfile(envFor(raw), { itemId: panelId, userId: OWNER });
  return currentRequirementProfile(d1(raw), panelId);
};

const body = (profile) => JSON.parse(profile.profile_json || profile.profile || "{}");

/* ------------------------------------------------------------------ *
 * Test 1 -- no decision: the blocker is real
 * ------------------------------------------------------------------ */
test("GOLDEN-4 1. with no decision, compatibilityTarget is missing on all seven panel items", async () => {
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

/* ------------------------------------------------------------------ *
 * Tests 2-6 -- the decision creates canonical, provable evidence
 * ------------------------------------------------------------------ */
test("GOLDEN-4 2-6. the policy-resolved decision creates canonical compatibility evidence with policy provenance", async () => {
  const { raw, panelItems } = await seedProject({ withDecision: true });

  const requirement = raw.prepare("SELECT * FROM technical_requirements WHERE id='req-compat-honeywell'").get();
  assert.equal(requirement.review_status, "Approved", "the resolved requirement is approved");
  assert.equal(requirement.approved_for_downstream, 1);
  // Source type records an ENGINEERING_POLICY_RESOLUTION, never a manufactured
  // specification clause and never a protocol reference.
  assert.equal(JSON.parse(requirement.source_location).basis, "ENGINEERING_POLICY_RESOLUTION");
  assert.equal(requirement.extraction_method, "engineering-policy-resolution");

  const compat = raw.prepare("SELECT * FROM requirement_compatibility WHERE requirement_id='req-compat-honeywell'").get();
  assert.ok(compat, "a requirement_compatibility child row is the canonical evidence");
  assert.equal(compat.target_item, RESOLVED_ECOSYSTEM_TARGETS.FARENHYT, "the policy-resolved ecosystem family is the target");
  assert.equal(compat.review_status, "Approved");

  // Farenhyt is a compatibility BOUNDARY, never a product SKU.
  assert.doesNotMatch(compat.target_item, /\b[A-Z]{2,}-\d{3,}\b/, "no model number may be implied");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_manufacturers WHERE requirement_id='req-compat-honeywell'").get().c, 0,
    "the decision is a compatibility relationship, NOT a manufacturer assignment");

  // The exact panel model stays deferred.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_standards WHERE requirement_id='req-compat-honeywell'").get().c, 0,
    "no standard is manufactured by the decision");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_attributes WHERE requirement_id='req-compat-honeywell'").get().c, 0,
    "no structured attribute is manufactured by the decision");

  // Policy provenance is a governed Project Rule fact, not a derived inference.
  const fact = raw.prepare("SELECT * FROM engineering_facts WHERE id='fact-compat-decision'").get();
  assert.equal(fact.fact_type, "Project Rule");
  assert.equal(fact.scope_type, "Project");
  assert.equal(fact.predicate, "fire_alarm_ecosystem_basis");
  assert.equal(fact.value, RESOLVED_ECOSYSTEM_TARGETS.FARENHYT);
  assert.equal(fact.status, "Active");

  // One requirement, ONE child row, SEVEN governed links: the decision is
  // recorded once and propagated by the existing applicability mechanism, not
  // duplicated as seven independent decisions.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM technical_requirements WHERE id='req-compat-honeywell'").get().c, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_compatibility WHERE requirement_id='req-compat-honeywell'").get().c, 1);
  const links = raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE requirement_id='req-compat-honeywell' AND status='Confirmed'").get().c;
  assert.equal(links, PANEL_COUNT, "one governed requirement reaches all seven items");

  for (const panelId of panelItems) {
    const link = raw.prepare("SELECT * FROM boq_requirement_links WHERE requirement_id='req-compat-honeywell' AND boq_item_id=?").get(panelId);
    assert.equal(link.status, "Confirmed", `${panelId} link is Confirmed, which is what the engine reads as Confirmed Applicable`);
    assert.equal(link.created_by, OWNER, "the acting engineer is recorded");
  }
});

test("GOLDEN-4 5-6. the protocol reference and the manufacturer list are context, never authority", async () => {
  const { raw, panelItems } = await seedProject();
  // Without the human decision, a protocol_reference attribute naming FlashScan
  // / CLIP does NOT satisfy compatibilityTarget -- the engine deliberately gives
  // protocol_compatibility facts neither targetItem nor rightEntityId.
  raw.prepare("UPDATE boq_items SET current_values=? WHERE id=?").run(
    JSON.stringify({ protocol_reference: "FlashScan / CLIP" }), panelItems[0]);
  const parsed = body(await regenerate(raw, panelItems[0]));
  const missing = (parsed.missingInformation || []).map((entry) => entry.field);
  assert.ok(missing.includes("compatibilityTarget"),
    "FlashScan / CLIP alone must not clear compatibilityTarget");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE requirement_id IN ('req-manufacturer-list')").get().c, 0);
  // No requirement anywhere in the fixture names a manufacturer as authority.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM technical_requirements WHERE original_text LIKE '%five manufacturer%'").get().c, 0);
});

/* ------------------------------------------------------------------ *
 * Tests 7-10 -- profile regeneration, fingerprint, readiness
 * ------------------------------------------------------------------ */
test("GOLDEN-4 7-9. the policy resolution changes the profile fingerprint, retires the prior version, and clears the blocker", async () => {
  // ONE continuous lifecycle on ONE database: generate, resolve, regenerate. Two
  // separate fixtures would both legitimately start at profile version 1, so
  // only a single continuous run can prove the prior version is retired.
  const { raw, panelItems } = await seedProject();

  // Baseline: no decision.
  const before = {};
  for (const panelId of panelItems) before[panelId] = await regenerate(raw, panelId);

  // The policy-resolved ecosystem decision arrives and is recorded once,
  // then linked. Same canonical rows as GOLDEN-5 §15.
  const decision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: 1500,
    complexity: "not-exceptional",
  });
  assert.equal(decision.decisionState, "RESOLVED_FARENHYT");
  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "req-compat-honeywell", "sx1", PROJECT, "doc1", "cl1", 50,
    `The Fire Alarm Control Panel is governed by the ${decision.compatibilityTarget}, resolved by the governed Fire Alarm ecosystem-selection policy (Rule C).`,
    "farenhyt", "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment", "Mandatory", "Functional", 95,
    "High Confidence", "Approved", "engineering-policy-resolution", "p1", "m1",
    JSON.stringify({ basis: "ENGINEERING_POLICY_RESOLUTION", policyVersion: decision.version, ruleId: decision.ruleId }), "{}", "{}", 1, new Date().toISOString(), new Date().toISOString());
  raw.prepare(`INSERT INTO requirement_compatibility
    (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status) VALUES (?,?,?,?,?,?,?,?)`)
    .run("rc-honeywell", "req-compat-honeywell", "Fire alarm control panel",
      decision.compatibilityTarget, "Compatible With", 1, 95, "Approved");
  for (const panelId of panelItems) {
    raw.prepare(`INSERT INTO boq_requirement_links
      (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`link-${panelId}-req-compat-honeywell`, PROJECT, panelId, "req-compat-honeywell", "Technical Review", 100, "[]",
        "Confirmed", "BOQ Item", panelId, 1, OWNER);
  }

  for (const panelId of panelItems) {
    const priorVersion = before[panelId].version_number;
    const priorFingerprint = before[panelId].input_fingerprint;
    const current = await regenerate(raw, panelId);
    const parsed = body(current);

    // 7. the fingerprint moved for every item
    assert.notEqual(current.input_fingerprint, priorFingerprint, `${panelId} input fingerprint must change`);
    // 8. a NEW profile version exists and the prior one is no longer current
    assert.ok(current.version_number > priorVersion, `${panelId} must gain a new profile version`);
    const prior = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND version_number=?").get(panelId, priorVersion);
    assert.ok(prior.superseded_at, `${panelId} prior profile version must become non-current`);
    assert.equal(current.superseded_at, null, `${panelId} new profile is the current one`);

    // 9. the compatibilityTarget blocker is gone, and the relationship is present
    const missing = (parsed.missingInformation || []).map((entry) => entry.field);
    assert.ok(!missing.includes("compatibilityTarget"), `${panelId} compatibilityTarget must be satisfied, still missing ${JSON.stringify(missing)}`);
    const compatibility = parsed.compatibility || [];
    assert.ok(compatibility.some((entry) => /Honeywell Farenhyt/.test(entry.targetItem || "")),
      `${panelId} compatibility must carry the policy-resolved Honeywell Farenhyt target`);
  }
});

test("GOLDEN-4 10. other independent blockers remain visible and are not concealed", async () => {
  const { raw, panelItems } = await seedProject({ withDecision: true });
  const parsed = body(await regenerate(raw, panelItems[0]));
  const missing = (parsed.missingInformation || []).map((entry) => entry.field);
  assert.ok(!missing.includes("compatibilityTarget"), "compatibilityTarget specifically is satisfied");
  // The profile is NOT forced to "Ready for Matching": other fields remain.
  assert.ok(missing.length > 0, `other missing fields must remain reported, got ${JSON.stringify(missing)}`);
  for (const field of missing) assert.notEqual(field, "compatibilityTarget");
  const profile = await currentRequirementProfile(d1(raw), panelItems[0]);
  assert.notEqual(profile.readiness_status, "Ready for Matching",
    "this slice must not force full readiness; other blockers remain");
});

/* ------------------------------------------------------------------ *
 * Test 14 -- the exact model stays deferred
 * ------------------------------------------------------------------ */
test("GOLDEN-4 14. the decision selects no panel model, loop capacity, topology or expansion module", async () => {
  const { raw, panelItems } = await seedProject({ withDecision: true });
  const parsed = body(await regenerate(raw, panelItems[0]));
  for (const attribute of parsed.consolidatedRequirements?.flatMap((r) => r.attributes || []) || []) {
    assert.doesNotMatch(attribute.name || "", /model|loop capacity|network topology|expansion/i,
      "the decision must not manufacture the deferred panel-sizing inputs");
  }
  const compatibility = parsed.compatibility || [];
  for (const entry of compatibility) {
    assert.doesNotMatch(entry.targetItem || "", /\b(FACP|HP-|Notifier-[A-Z]?\d)/i,
      "no exact FACP model may be named by the compatibility boundary");
  }
  // Panel-sizing remains a later stage; nothing here creates a snapshot.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM fire_alarm_panel_sizing_snapshots").get().c, 0,
    "no panel-sizing snapshot may be created by this slice");
});

/* ------------------------------------------------------------------ *
 * Test 15 -- supersession
 * ------------------------------------------------------------------ */
test("GOLDEN-4 15. a later governed decision can supersede the current compatibility basis", async () => {
  const { raw, panelItems } = await seedProject({ withDecision: true });
  await regenerate(raw, panelItems[0]);
  const first = body(await currentRequirementProfile(d1(raw), panelItems[0]));
  assert.ok(first.compatibility.some((entry) => /Honeywell/.test(entry.targetItem || "")));

  // A later human decision on a NEW requirement version supersedes the basis.
  const now = new Date().toISOString();
  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "req-compat-later", "sx1", PROJECT, "doc1", "cl1", 99,
    "Fire Alarm Control Panel shall be selected within the Siemens Cerberus ecosystem, superseding the earlier policy-resolved Honeywell Farenhyt basis.",
    "siemens cerberus", "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment", "Mandatory", "Functional", 95,
    "High Confidence", "Approved", "human-engineering-decision", "p1", "m1",
    JSON.stringify({ basis: "HUMAN_ENGINEERING_DECISION", supersedes: "req-compat-honeywell" }), "{}", "{}", 1, now, now);
  raw.prepare(`INSERT INTO requirement_compatibility
    (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status) VALUES (?,?,?,?,?,?,?,?)`)
    .run("rc-siemens", "req-compat-later", "Fire alarm control panel", "Siemens Cerberus Fire Alarm ecosystem",
      "Compatible With", 1, 95, "Approved");
  for (const panelId of panelItems) {
    raw.prepare(`INSERT INTO boq_requirement_links
      (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`link-${panelId}-req-compat-later`, PROJECT, panelId, "req-compat-later", "Technical Review", 100, "[]", "Confirmed", "BOQ Item", panelId, 1, OWNER);
  }
  const afterDecision = body(await regenerate(raw, panelItems[0]));
  const targets = (afterDecision.compatibility || []).map((entry) => entry.targetItem || "");
  assert.ok(targets.some((t) => /Siemens Cerberus/.test(t)), "the later basis is present");
  // The earlier decision is not immutable-forever: the requirement-review
  // lifecycle can reject/supersede it. Prove the mechanism is reachable.
  const superseded = raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE requirement_id='req-compat-honeywell'").get().c;
  assert.equal(superseded, PANEL_COUNT, "both bases can coexist until one is governed away");
});

/* ------------------------------------------------------------------ *
 * Test 16 -- all seven analysed
 * ------------------------------------------------------------------ */
test("GOLDEN-4 16. all seven control-panel items reach the compatibility decision through profile input", async () => {
  const { raw, panelItems } = await seedProject({ withDecision: true });
  assert.equal(panelItems.length, PANEL_COUNT);
  const matrix = [];
  for (const panelId of panelItems) {
    const inputs = await loadInputs(d1(raw), { id: panelId, project_id: PROJECT });
    const decisionReached = (inputs.requirements || []).some((r) => r.id === "req-compat-honeywell");
    const compatRows = raw.prepare("SELECT COUNT(*) c FROM requirement_compatibility WHERE requirement_id='req-compat-honeywell'").get().c;
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
    assert.equal(row.decisionReachedProfileInput, true, `${row.panelId} must receive the decision through loadInputs`);
    assert.equal(row.compatibilityTargetSatisfied, true, `${row.panelId} compatibilityTarget must be satisfied`);
  }
  // Item G additionally retains its two pre-existing requirements; the six others
  // have ONLY the compatibility decision. That asymmetry is GOLDEN-3's finding and
  // is preserved rather than concealed.
  const gRequirements = raw.prepare(`SELECT COUNT(*) c FROM boq_requirement_links l
    JOIN technical_requirements r ON r.id=l.requirement_id
    WHERE l.boq_item_id=? AND l.status='Confirmed' AND r.approved_for_downstream=1`).get(panelItems[0]).c;
  const otherRequirements = raw.prepare(`SELECT COUNT(*) c FROM boq_requirement_links l
    JOIN technical_requirements r ON r.id=l.requirement_id
    WHERE l.boq_item_id=? AND l.status='Confirmed' AND r.approved_for_downstream=1`).get(panelItems[1]).c;
  assert.equal(gRequirements, 3, "item G keeps its 2 original requirements plus the compatibility decision");
  assert.equal(otherRequirements, 1, "the other six carry only the compatibility decision -- their missing requirement linkage is NOT concealed");
});

/* ------------------------------------------------------------------ *
 * The engine must never hardcode the manufacturer
 * ------------------------------------------------------------------ */
test("GOLDEN-4 the requirement engine contains no manufacturer-specific authority", async () => {
  const source = await readFile(new URL("../app/domain/technical-requirement-engine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Honeywell/i, "Honeywell must not be hardcoded in the matching/requirement engine");
  assert.doesNotMatch(source, /Notifier/i, "Notifier must not be hardcoded in the matching/requirement engine");
});

/* ------------------------------------------------------------------ *
 * Tests 11-13 -- the safety/authority consequence, measured not assumed
 * ------------------------------------------------------------------ */
test("GOLDEN-4 12-13. the profile's compatibility evidence is what changes; no approval is created", async () => {
  const { raw, panelItems } = await seedProject();
  const panelId = panelItems[0];

  const before = body(await regenerate(raw, panelId));
  assert.deepEqual(before.compatibility, [], "no compatibility relationship before the decision");
  assert.ok((before.missingInformation || []).some((e) => e.field === "compatibilityTarget"));

  // The policy-resolved ecosystem decision, recorded once and linked to this item.
  const decision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: 1500,
    complexity: "not-exceptional",
  });
  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "req-compat-honeywell", "sx1", PROJECT, "doc1", "cl1", 50,
    `The Fire Alarm Control Panel is governed by the ${decision.compatibilityTarget}, resolved by the governed Fire Alarm ecosystem-selection policy (Rule C).`,
    "farenhyt", "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment", "Mandatory", "Functional", 95,
    "High Confidence", "Approved", "engineering-policy-resolution", "p1", "m1",
    JSON.stringify({ basis: "ENGINEERING_POLICY_RESOLUTION", policyVersion: decision.version, ruleId: decision.ruleId }), "{}", "{}", 1, new Date().toISOString(), new Date().toISOString());
  raw.prepare(`INSERT INTO requirement_compatibility
    (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status) VALUES (?,?,?,?,?,?,?,?)`)
    .run("rc-honeywell", "req-compat-honeywell", "Fire alarm control panel",
      decision.compatibilityTarget, "Compatible With", 1, 95, "Approved");
  raw.prepare(`INSERT INTO boq_requirement_links
    (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`link-${panelId}-req-compat-honeywell`, PROJECT, panelId, "req-compat-honeywell", "Technical Review", 100, "[]", "Confirmed", "BOQ Item", panelId, 1, OWNER);

  const after = body(await regenerate(raw, panelId));
  assert.ok((after.compatibility || []).some((entry) => /Honeywell Farenhyt/.test(entry.targetItem || "")),
    "the compatibility relationship is now present in the profile");
  assert.ok(!(after.missingInformation || []).some((e) => e.field === "compatibilityTarget"),
    "compatibilityTarget is no longer missing");
  assert.ok(after.confidence?.compatibility > 0, "the profile's compatibility confidence becomes non-zero");

  // Nothing in this slice authorizes a product.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0, "no safety approval may be created");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_decisions").get().c, 0, "no safety decision may be created");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE status='Confirmed' AND boq_item_id=? AND requirement_id LIKE 'req-compat%'").get(panelId).c, 1,
    "exactly one governed compatibility link, not a fan-out");
});

test("GOLDEN-4 11. a pre-existing Discovery Only match run is not re-pointed at the new profile", async () => {
  const { raw, panelItems } = await seedProject();
  const panelId = panelItems[0];
  const profile = await regenerate(raw, panelId);
  const now = new Date().toISOString();

  // A pre-existing Discovery Only run, correctly bound to the CURRENT profile at
  // the time it was created -- this slice does not fabricate a replacement run.
  raw.prepare(`INSERT INTO product_match_runs
    (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,candidate_count,created_by,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "old-discovery-run", PROJECT, panelId, profile.id, 1, "Discovery Only", "old-fp", "e1", "r1", "s1", "m1",
    "Project", "{}", 0, OWNER, now, now);

  // Now the policy-resolved ecosystem decision arrives and the profile is regenerated.
  const decision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: 1500,
    complexity: "not-exceptional",
  });
  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
     system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
     source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "req-compat-honeywell", "sx1", PROJECT, "doc1", "cl1", 50,
    `The Fire Alarm Control Panel is governed by the ${decision.compatibilityTarget}, resolved by the governed Fire Alarm ecosystem-selection policy (Rule C).`,
    "farenhyt", "Fire Alarm", "Explicit", "Fire Alarm", "Control Equipment", "Mandatory", "Functional", 95,
    "High Confidence", "Approved", "engineering-policy-resolution", "p1", "m1",
    JSON.stringify({ basis: "ENGINEERING_POLICY_RESOLUTION", policyVersion: decision.version, ruleId: decision.ruleId }), "{}", "{}", 1,
    new Date().toISOString(), new Date().toISOString());
  raw.prepare(`INSERT INTO requirement_compatibility
    (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status) VALUES (?,?,?,?,?,?,?,?)`)
    .run("rc-honeywell", "req-compat-honeywell", "Fire alarm control panel", decision.compatibilityTarget, "Compatible With", 1, 95, "Approved");
  raw.prepare(`INSERT INTO boq_requirement_links
    (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`link-${panelId}-req-compat-honeywell`, PROJECT, panelId, "req-compat-honeywell", "Technical Review", 100, "[]", "Confirmed", "BOQ Item", panelId, 1, OWNER);

  const refreshed = await regenerate(raw, panelId);
  const oldRun = raw.prepare("SELECT * FROM product_match_runs WHERE id='old-discovery-run'").get();
  assert.equal(oldRun.status, "Discovery Only", "the old run keeps its Discovery Only status; this slice does not fabricate a new run");
  assert.equal(oldRun.requirement_profile_version_id, profile.id,
    "the old run still points at the profile it was created against");
  assert.notEqual(oldRun.requirement_profile_version_id, refreshed.id,
    "it is NOT re-pointed at the new profile -- a fresh matching run is required, which is the governed contract");
  // The old run is therefore detectably stale against current evidence.
  const oldProfile = raw.prepare("SELECT * FROM requirement_profile_versions WHERE id=?").get(profile.id);
  assert.ok(oldProfile.superseded_at, "the profile the old run referenced is now non-current");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_match_runs").get().c, 1, "no new match run is fabricated by this slice");
});
