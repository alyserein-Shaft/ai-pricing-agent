/**
 * GOLDEN-6 -- GOVERNED FACP REQUIREMENT LINKAGE COMPLETION.
 *
 * Closes the governed technical-requirement linkage gap across the seven
 * Fire Alarm Control Panel (FACP) BOQ items WITHOUT fabricating completeness.
 *
 * THE AUTHORITY IS THE GOVERNED FACP REQUIREMENT APPLICABILITY POLICY
 * (app/domain/facp-requirement-applicability-policy.mjs): requirement
 * similarity != requirement applicability. A (requirement, item) pair becomes
 * a governed Confirmed link ONLY through an explicit, traceable basis --
 * never from similar BOQ descriptions, same-system membership, another FACP
 * item carrying it, commercial convenience, or an assumed panel identity.
 *
 * The fixture is a replica of the acceptance project's SHAPE only (read-only,
 * never touched by this suite): seven Fire Alarm Control Panel items, six of
 * which carry no active Confirmed requirement link at all, and one (the main
 * FACP, item G equivalent) carrying only two historical auto-confirm CAS
 * proposals that were superseded before confirmation. The requirement set
 * mirrors the approved requirements found in the acceptance project's current
 * extraction (FACP display, panel software, panel network, workstation GUI,
 * SLC wiring, digital-data-network wiring, voice evacuation, ineligible draft,
 * ineligible rejected, a superseded extraction's stale row, its active
 * re-extraction, an ambiguous clause, and the GOLDEN-5-resolved ecosystem
 * compatibility requirement).
 *
 * Everything downstream goes through the project's EXISTING canonical model:
 *
 *   technical_requirements (approved, current, eligible)
 *     +-- requirement_compatibility (the ecosystem child row)
 *     +-- boq_requirement_links    (status='Confirmed', one per applicable
 *                                   item, UNIQUE (boq_item_id, requirement_id,
 *                                   version_number))
 *     +-- requirement_profile_versions (old superseded, new current)
 *     +-- product_match_runs       (old runs pinned to their historical
 *                                   profile version, never re-pointed)
 *
 * READINESS IS NEVER FORCED: after the full governed propagation the profile
 * reports compatibilityTarget satisfied but `standard` still missing (no
 * approved requirement_standards child exists), so
 * confidence.standards=0 => overall<80 => "Ready with Warnings", exactly the
 * engine's own honest calculation. Requirement links are never readiness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  FACP_APPLICABILITY_POLICY_VERSION,
  FACP_APPLICABILITY_STATUSES,
  APPLICABILITY_EVIDENCE_BASES,
  APPLICABILITY_RULES,
  ECOSYSTEM_RESOLVED_STATES,
  ECOSYSTEM_UNRESOLVED_STATES,
  EXPLICIT_REQUIREMENT_SCOPE_EVIDENCE,
  ECOSYSTEM_DECISION_AUTHORITIES,
  ecosystemPropagationPermitted,
  classifyRequirementApplicability,
  planApplicabilityLinks,
} from "../app/domain/facp-requirement-applicability-policy.mjs";
import {
  resolveFireAlarmEcosystem,
  RESOLVED_ECOSYSTEM_TARGETS,
  AUTHORITY_BASES,
} from "../app/domain/fire-alarm-ecosystem-policy.mjs";
import { loadInputs, executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { currentRequirementProfile } from "../worker/requirement-profile-currency.mjs";

const OWNER = "golden6-engineer";
const PROJECT = "golden6-project";
const PANEL_COUNT = 7;

const REQ = {
  ecosystem: "req-ecosystem",
  facpDisplay: "req-facp-display",
  panelSoftware: "req-panel-software",
  networkPanels: "req-network-panels",
  mainGui: "req-main-gui",
  slc: "req-slc",
  wiring: "req-wiring-network",
  voice: "req-voice",
  similar: "req-similar",
  draft: "req-draft",
  rejected: "req-rejected",
  superseded: "req-superseded",
  active: "req-superseded-active",
  ambiguous: "req-ambiguous",
};

// Governed evidence asserted by the CALLER (the GOLDEN-6 report's applicability
// analysis). The classifier never invents any of this from description text.
const FACP_EVIDENCE = {
  [REQ.networkPanels]: {
    base: "APPROVED_PROJECT_WIDE_REQUIREMENT",
    note: "Approved project-wide network obligation: the main FACP, repeater panels, and every Building Fire Alarm Panel must be networked together.",
  },
  [REQ.mainGui]: {
    base: "SAME_DRAWING_SYSTEM_REFERENCE",
    scopeItemIds: ["panel-1"],
    note: "The operator workstation is sighted at the main building; the drawing/system reference names only the main FACP item.",
  },
  [REQ.voice]: {
    base: "EXPLICIT_BOQ_RELATIONSHIP",
    scopeItemIds: [],
    note: "The modeled relationship attaches the voice-evacuation requirement to notification-appliance items; FACP equipment is explicitly outside its scope.",
  },
  [REQ.active]: {
    base: "APPROVED_PROJECT_WIDE_REQUIREMENT",
    note: "Approved project-wide compliance obligation (NFPA-72/75, EN54, relevant electrical codes) governing every FACP item; the superseded extraction's twin is never linked.",
  },
};

// GOLDEN-6A -- EXPLICIT GOVERNED SCOPE DECLARATIONS attached to the
// REQUIREMENT itself (mission sections 4, 5, 17). The approved extraction
// explicitly declares the system/category scope the requirement governs. Item
// classifications ONLY VALIDATE whether an item falls within an already
// declared scope; they never establish one. The two requirements that the
// GOLDEN-6 fixture previously confirmed through the permissive system/category
// fallback now carry their scope as a governed declaration instead of relying
// on any inferred match -- the permissive fallback itself no longer exists.
const REQ_GOVERNED_SCOPE = {
  [REQ.facpDisplay]: { system: "Fire Alarm", category: "Control Equipment" },
  [REQ.panelSoftware]: { system: "Fire Alarm", category: "Control Equipment" },
};

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
 * A Fire Alarm project with SEVEN FACP BOQ items, shaped like the acceptance
 * project's seven-panel condition (read-only there; the fixture is a replica
 * of its SHAPE only and contains none of its data):
 *   - panel-1 is the MAIN FACP (item G equivalent) and carries two HISTORICAL
 *     auto-confirm CAS proposals (Suggested, already superseded) -- preserved
 *     exactly as history, never consumed by profile generation;
 *   - panels 2-7 carry no requirement link at all.
 * The approved requirement set mirrors the acceptance project's current
 * extraction, so the six under-linked items are no longer missing valid
 * governed requirement links after the policy plan runs.
 *
 * @param {{ecosystem: "resolved"|"none"}} options ecosystem "resolved" records
 *   the GOLDEN-5 Farenhyt decision (carrier requirement + compatibility child +
 *   project-rule fact) but NO links -- deciding the ecosystem is not the same
 *   as propagating it. "none" records no decision at all.
 */
const seedProject = async ({ ecosystem = "resolved" } = {}) => {
  const raw = await activeChain();
  const now = new Date().toISOString();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);

  run("INSERT INTO organizations (id,name) VALUES (?,?)", "org1", "GOLDEN-6 Org");
  run("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)",
    PROJECT, "GOLDEN-6 Seven-Panel Replica Project", OWNER, "org1", "Fire Alarm", "Active");
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
  // TWO spec extractions: sx-old is superseded (version 1), sx1 is the
  // current extraction (version 2). The canonical currency join excludes every
  // requirement on sx-old; sx1 is the only live evidence.
  run(`INSERT INTO specification_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,superseded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, "sx-old", "doc1", "dv1", 1, "Completed", "p1", "r1", "m1", "pr1", "o1", OWNER, "2026-01-15T00:00:00.000Z");
  run(`INSERT INTO specification_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,superseded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, "sx1", "doc1", "dv1", 2, "Completed", "p1", "r1", "m1", "pr1", "o1", OWNER, null);
  run(`INSERT INTO specification_clauses (id,extraction_version_id,sequence,kind,path,original_text) VALUES (?,?,?,?,?,?)`,
    "cl-old", "sx-old", 1, "Requirement", "0", "Old system requirements");
  run(`INSERT INTO specification_clauses (id,extraction_version_id,sequence,kind,path,original_text) VALUES (?,?,?,?,?,?)`,
    "cl1", "sx1", 1, "Requirement", "1", "System requirements");

  const panelItems = [];
  const panelDescriptions = [
    "Main Fire alarm control panel with all required hardware, interfaces, cabling, and accessories, for connectivity to the FACP panels installed in the individual school buildings and Welcome center",
    ...Array.from({ length: PANEL_COUNT - 1 }, () => "Fire alarm control panel with all accessories"),
  ];
  for (let i = 1; i <= PANEL_COUNT; i += 1) {
    const id = `panel-${i}`;
    run(`INSERT INTO boq_items
      (id,extraction_version_id,project_id,source_document_id,sequence,hierarchy_depth,section_path,row_type,item_number,description,system_value,category,
       normalized_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,
       approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, "bx1", PROJECT, "doc1", i, 0, "1", "Item", String(i), panelDescriptions[i - 1], "Fire Alarm", "Control Equipment", "EA", 1, 1,
      95, "High Confidence", "Approved", "{}", "{}", "{}", 1, now, now);
    panelItems.push(id);
  }

  let sx1Sequence = 0;
  let sxOldSequence = 0;
  const insertRequirement = ({
    id, extractionVersionId = "sx1", clauseId = "cl1", text, system = "Fire Alarm", category = "Control Equipment",
    reviewStatus = "Approved", approvedForDownstream = 1, requirementType = "Mandatory",
    extractionMethod = "human-engineering-decision", basis = "HUMAN_ENGINEERING_DECISION", requirementCategory = "Functional",
  }) => {
    const sequence = extractionVersionId === "sx-old" ? (sxOldSequence += 1) : (sx1Sequence += 1);
    run(`INSERT INTO technical_requirements
      (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
       system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
       source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, extractionVersionId, PROJECT, "doc1", clauseId, sequence, text, text.toLowerCase(), "Fire Alarm", "Explicit", system, category,
      requirementType, requirementCategory, 90, "High Confidence", reviewStatus, extractionMethod, "p1", "m1",
      JSON.stringify({ basis }), "{}", "{}", approvedForDownstream, now, now);
  };

  // --- The approved requirement set, mirroring the acceptance project's
  // current extraction (real clause substance, fixture IDs).
  insertRequirement({
    id: REQ.facpDisplay,
    text: "The Fire Alarm Control Panel (FACP) shall feature switches and an LCD/LED display for system interaction.",
  });
  insertRequirement({
    id: REQ.panelSoftware,
    text: "The software must be built into the panel itself and should not rely on any higher-level computer to run.",
  });
  insertRequirement({
    id: REQ.networkPanels,
    text: "The fire alarm control panel, repeater panel, and Building Fire Alarm Panel must be networked together and connected to the central monitoring station.",
  });
  insertRequirement({
    id: REQ.mainGui,
    text: "The color graphic terminal must provide interactive (real-time) visualization of all alarms, fault conditions, and specific points of the fire alarm system.",
  });
  // The SLC clause keeps its real extraction category ("Modules and
  // Interfaces"), which does NOT match the panel's "Control Equipment" scope;
  // the CAS refused this pair in the acceptance project and the policy
  // preserves that refusal (no evidence was ever recorded either).
  insertRequirement({
    id: REQ.slc,
    category: "Modules and Interfaces",
    text: "Each SLC must accommodate NFPA 72 Style 4, Style 6, or Style 7 (Class A or B) wiring configurations.",
  });
  insertRequirement({
    id: REQ.wiring,
    category: "Network",
    text: "The wiring for detection circuits, alarm devices, and the main loop of the addressable fire alarm system shall form a digital data network.",
  });
  insertRequirement({
    id: REQ.voice,
    category: "Other",
    text: "Voice evacuation notification appliances shall be provided in accordance with the applicable code and the approved voice evacuation strategy.",
  });
  // Deliberately IDENTICAL description to panels 2-7, but no governed scope or
  // evidence: the similarity negative. Extraction scope says Other, nothing else.
  insertRequirement({
    id: REQ.similar,
    category: "Other",
    text: "Fire alarm control panel with all accessories",
  });
  insertRequirement({
    id: REQ.draft,
    reviewStatus: "Draft",
    approvedForDownstream: 0,
    text: "The panel shall be listed with a programmable, non-volatile memory database.",
  });
  insertRequirement({
    id: REQ.rejected,
    reviewStatus: "Rejected",
    approvedForDownstream: 0,
    text: "The panel shall provide spare capacity for future expansion beyond the project scope.",
  });
  // The superseded extraction's stale twin is NEVER the source of a link.
  insertRequirement({
    id: REQ.superseded,
    extractionVersionId: "sx-old",
    clauseId: "cl-old",
    category: "Compliance",
    text: "The complete installation shall adhere to applicable sections of NFPA 72, EN54, and relevant electrical codes.",
  });
  insertRequirement({
    id: REQ.active,
    category: "Compliance",
    text: "The complete installation shall adhere to applicable sections of NFPA-72, 75, EN54, and relevant electrical codes.",
  });
  insertRequirement({
    id: REQ.ambiguous,
    text: "A panel-wise and building-wise Cause and Effect Matrix shall be developed and submitted for all fire alarm and detection zones.",
  });

  // panel-1's two HISTORICAL auto-confirm CAS proposals, Suggested and already
  // superseded -- the exact shape the live D1 snapshot records for item G.
  // Preserved as history, never deleted, never re-promoted, never consumed by
  // profile generation (status='Confirmed' AND superseded_at IS NULL).
  for (const requirementId of [REQ.slc, REQ.wiring]) {
    run(`INSERT INTO boq_requirement_links
      (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by,superseded_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      `history-${requirementId}`, PROJECT, "panel-1", requirementId, "Auto Confirm CAS Proposal", 82,
      JSON.stringify([{ basis: "AUTO_CONFIRM_CAS_PROPOSAL", status: "Suggested", superseded: true }]),
      "Suggested", "BOQ Item", "panel-1", 1, OWNER, "2026-09-20T14:44:35.184Z");
  }

  let decision = null;
  if (ecosystem === "resolved") {
    // THE GOLDEN-5 RESOLUTION: UL/FM regime + 1,500 preliminary points +
    // established not-exceptional complexity -> Honeywell Farenhyt. Recorded
    // ONCE: carrier requirement + compatibility child row + project-rule fact.
    // No links yet -- resolution is not propagation; the six under-linked
    // items stay under-linked until the governed plan creates the links.
    decision = resolveFireAlarmEcosystem({
      complianceRegime: "UL/FM",
      preliminaryTotalPoints: 1500,
      complexity: "not-exceptional",
    });
    if (decision.decisionState !== "RESOLVED_FARENHYT") {
      throw new Error(`fixture resolution failed: ${decision.decisionState}`);
    }
    insertRequirement({
      id: REQ.ecosystem,
      extractionMethod: "engineering-policy-resolution",
      basis: decision.basis,
      text: `The Fire Alarm Control Panel and addressable-loop devices are resolved to the ${decision.compatibilityTarget} `
        + `by the governed Fire Alarm ecosystem-selection policy (Rule C: UL/FM regime, 1,500 preliminary points, `
        + `established not-exceptional complexity; policy version ${decision.version}; rule ${decision.ruleId}).`,
    });
    run(`INSERT INTO requirement_compatibility
      (id,requirement_id,source_item,target_item,relationship_type,mandatory,confidence,review_status)
      VALUES (?,?,?,?,?,?,?,?)`,
      "rc-ecosystem", REQ.ecosystem, "Fire alarm control panel", decision.compatibilityTarget,
      "Compatible With", 1, 95, "Approved");
    run(`INSERT INTO engineering_facts
      (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,version_number,model_version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "fact-ecosystem-basis", PROJECT, "Project", PROJECT, "fire_alarm_ecosystem_basis",
      decision.resolvedEcosystem, "Text", "=", "Project Rule", "Project", PROJECT, "Active", 100, 1, "m1", now);
  }

  return { raw, panelItems, decision };
};

const envFor = (raw) => ({
  DB: d1(raw),
  FILES: { get: async () => null, head: async () => null },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "golden6@test.invalid",
  APP_USER_NAME: "GOLDEN-6 Technical Manager",
  waitUntil: () => undefined,
});

const regenerate = async (raw, panelId) => {
  await executeRequirementProfile(envFor(raw), { itemId: panelId, userId: OWNER });
  return currentRequirementProfile(d1(raw), panelId);
};

const body = (profile) => JSON.parse(profile.profile_json || profile.profile || "{}");

const panelContexts = (panelItems) =>
  panelItems.map((id) => ({ id, system: "Fire Alarm", category: "Control Equipment" }));

// The planner's requirement view, shaped from the LIVE DB exactly like the
// canonical downstream join: only rows belonging to a CURRENT extraction are
// marked extractionIsCurrent, and the ecosystem carrier is identified by id.
const readRequirements = (raw) =>
  raw
    .prepare(`
      SELECT r.id, r.review_status AS reviewStatus, r.approved_for_downstream AS approvedForDownstream,
             r.system, r.category,
             CASE WHEN e.superseded_at IS NULL THEN 1 ELSE 0 END AS extractionIsCurrent
      FROM technical_requirements r
      JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
      WHERE r.project_id = ?
      ORDER BY r.sequence
    `)
    .all(PROJECT)
    .map((row) => ({
      id: row.id,
      reviewStatus: row.reviewStatus,
      approvedForDownstream: Number(row.approvedForDownstream),
      system: row.system,
      category: row.category,
      extractionIsCurrent: Number(row.extractionIsCurrent) === 1,
      // GOLDEN-6A: the explicit governed scope declaration carried by the
      // requirement itself (scope-ESTABLISHING); item classifications only
      // validate items against it.
      governedScope: REQ_GOVERNED_SCOPE[row.id] ?? null,
      ecosystemCarrier: row.id === REQ.ecosystem,
      ambiguity: row.id === REQ.ambiguous,
    }));

const existingLinkRows = (raw) =>
  raw
    .prepare(`
      SELECT requirement_id AS requirementId, boq_item_id AS itemId, version_number AS versionNumber
      FROM boq_requirement_links
      WHERE project_id=? AND superseded_at IS NULL AND status='Confirmed'
    `)
    .all(PROJECT);

const applyPlan = (raw, plan) => {
  let created = 0;
  for (const link of plan.linksToCreate) {
    const exists = raw
      .prepare("SELECT 1 AS one FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id=? AND version_number=1")
      .get(link.itemId, link.requirementId);
    if (exists) continue;
    raw
      .prepare(`INSERT INTO boq_requirement_links
        (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`link-${link.itemId}-${link.requirementId}`, PROJECT, link.itemId, link.requirementId,
        link.linkMethod, link.confidence, JSON.stringify(link.evidence), "Confirmed", "BOQ Item", link.itemId, link.versionNumber, OWNER);
    created += 1;
  }
  return created;
};

const planAndApply = (raw, panelItems, { ecosystem = null, evidence = null } = {}) => {
  const requirements = readRequirements(raw);
  const items = panelContexts(panelItems);
  const plan = planApplicabilityLinks({
    requirements,
    items,
    ecosystem,
    evidenceByRequirement: { ...FACP_EVIDENCE, ...(evidence || {}) },
    existingLinks: existingLinkRows(raw),
  });
  const created = applyPlan(raw, plan);
  return { plan, created, requirements, items };
};

const activeConfirmedLinkCount = (raw, panelId) =>
  raw
    .prepare("SELECT COUNT(*) AS n FROM boq_requirement_links WHERE boq_item_id=? AND status='Confirmed' AND superseded_at IS NULL")
    .get(panelId).n;

const linkedRequirementIds = (raw, panelId) =>
  raw
    .prepare(`
      SELECT requirement_id AS requirementId FROM boq_requirement_links
      WHERE boq_item_id=? AND status='Confirmed' AND superseded_at IS NULL ORDER BY requirement_id
    `)
    .all(panelId)
    .map((row) => row.requirementId);

const missingFields = (parsed) => (parsed.missingInformation || []).map((entry) => entry.field);

/* ------------------------------------------------------------------ *
 * Test 1 -- the truthful pre-GOLDEN-6 inventory on the replica
 * ------------------------------------------------------------------ */
test("GOLDEN-6 1. pre-state: six items carry zero active links, main FACP carries only superseded history, and ecosystem resolution alone does not ready any item", async () => {
  const { raw, panelItems } = await seedProject({ ecosystem: "resolved" });

  // Replica inventory: seven FACP items, six of them with NO link of any kind,
  // panel-1 with exactly two HISTORICAL Suggested links that are superseded.
  assert.equal(panelItems.length, 7);
  for (const panelId of panelItems) {
    const all = raw.prepare("SELECT status, superseded_at FROM boq_requirement_links WHERE boq_item_id=?").all(panelId);
    if (panelId === "panel-1") {
      assert.equal(all.length, 2, "main FACP has two historical CAS proposal links");
      for (const row of all) {
        assert.equal(row.status, "Suggested", "history link stays Suggested, never auto-promoted");
        assert.ok(row.superseded_at, "history link stays superseded");
      }
    } else {
      assert.equal(all.length, 0, `${panelId} must start with zero links -- the six under-linked items`);
    }
    // The profile inputs join requires status='Confirmed' AND superseded_at IS
    // NULL, so NONE of the seven panels has any live requirement input yet.
    assert.equal(activeConfirmedLinkCount(raw, panelId), 0, `${panelId} pre-state has zero active Confirmed links`);
    const inputs = await loadInputs(d1(raw), { id: panelId, project_id: PROJECT });
    assert.deepEqual(inputs.requirements, [], `${panelId} pre-state has zero Consumed requirement inputs`);
  }

  // Even though the ecosystem decision IS recorded, no profile is ready: the
  // resolution alone is not linkage, and linkage is the input that matters.
  for (const panelId of panelItems) {
    const profile = await regenerate(raw, panelId);
    const parsed = body(profile);
    const missing = missingFields(parsed);
    assert.ok(missing.includes("compatibilityTarget"), `${panelId} must be blocked on compatibilityTarget`);
    assert.equal(profile.readiness_status, "Missing Critical Information", `${panelId} readiness must stay blocked pre-link`);
    assert.equal(profile.version_number, 1, `${panelId} first profile is version 1`);
  }
});

/* ------------------------------------------------------------------ *
 * Test 2 -- similarity, same-system membership, and ineligible rows
 * ------------------------------------------------------------------ */
test("GOLDEN-6 2. same description, same system, draft, rejected, and superseded-versions never plan a link (acceptance 4/5/6/7 + negatives 1/2/8)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  const requirements = readRequirements(raw);
  const items = panelContexts(panelItems);
  const plan = planApplicabilityLinks({ requirements, items, ecosystem: decision, evidenceByRequirement: FACP_EVIDENCE, existingLinks: existingLinkRows(raw) });

  for (const item of items) {
    const byId = (requirementId) => plan.classifications.find((entry) => entry.requirementId === requirementId && entry.itemId === item.id);
    // Same description as panels 2-7, but no governed scope => fail closed.
    assert.equal(byId(REQ.similar)?.status, "INSUFFICIENT_EVIDENCE", `${item.id}: identical description is not applicability`);
    // Same system (Fire Alarm) but a different extracted scope => NOT_APPLICABLE
    // via the modeled relationship, or fail-closed for the unmodeled device clause.
    assert.equal(byId(REQ.voice)?.status, "NOT_APPLICABLE", `${item.id}: same system membership is not applicability`);
    assert.equal(byId(REQ.slc)?.status, "INSUFFICIENT_EVIDENCE", `${item.id}: CAS-refused SLC pair stays refused`);
    assert.equal(byId(REQ.wiring)?.status, "INSUFFICIENT_EVIDENCE", `${item.id}: wiring requirement has no panel evidence`);
    // Eligibility and currency never plan.
    assert.equal(byId(REQ.draft)?.status, "NOT_APPLICABLE", `${item.id}: draft never links`);
    assert.equal(byId(REQ.rejected)?.status, "NOT_APPLICABLE", `${item.id}: rejected never links`);
    assert.equal(byId(REQ.superseded)?.status, "NOT_APPLICABLE", `${item.id}: superseded version never links`);
  }
  assert.equal(plan.linksToCreate.some((link) => link.requirementId === REQ.similar), false, "similarity never becomes a link");
  assert.equal(plan.linksToCreate.some((link) => link.requirementId === REQ.draft), false, "draft never becomes a link");
  assert.equal(plan.linksToCreate.some((link) => link.requirementId === REQ.superseded), false, "superseded version never becomes a link");

  // Engine defense-in-depth: even a wrongly-inserted Confirmed link to a Draft
  // requirement is excluded from downstream inputs by the canonical eligibility
  // join -- the worker hardens the same contract the planner enforces.
  raw.prepare(`INSERT INTO boq_requirement_links
    (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("wrong-draft-link", PROJECT, "panel-1", REQ.draft, "Wrong Insert", 100, "[]", "Confirmed", "BOQ Item", "panel-1", 1, OWNER);
  const inputs = await loadInputs(d1(raw), { id: "panel-1", project_id: PROJECT });
  assert.equal(inputs.requirements.some((entry) => entry.id === REQ.draft), false,
    "loadInputs (currentTechnicalRequirementsFrom + eligibility predicate) must exclude the Draft row even when wrongly linked");
});

/* ------------------------------------------------------------------ *
 * Test 3 -- the module's own vocabulary and the ecosystem gate
 * ------------------------------------------------------------------ */
test("GOLDEN-6 3. the four statuses, six bases, and the ecosystem propagation gate (mission sections 6 and 7)", async () => {
  assert.deepEqual(FACP_APPLICABILITY_STATUSES, [
    "CONFIRMED_APPLICABLE",
    "NOT_APPLICABLE",
    "INSUFFICIENT_EVIDENCE",
    "REQUIRES_ENGINEERING_REVIEW",
  ]);
  assert.deepEqual(APPLICABILITY_EVIDENCE_BASES, [
    "GOVERNED_ECOSYSTEM_DECISION",
    "SAME_EXPLICIT_SYSTEM_SCOPE",
    "SAME_DRAWING_SYSTEM_REFERENCE",
    "APPROVED_PROJECT_WIDE_REQUIREMENT",
    "HUMAN_ENGINEERING_DECISION",
    "EXPLICIT_BOQ_RELATIONSHIP",
  ]);
  assert.deepEqual(ECOSYSTEM_RESOLVED_STATES, [
    "EXPLICIT_PROJECT_ECOSYSTEM",
    "RESOLVED_FARENHYT",
    "RESOLVED_GENT",
  ]);
  assert.deepEqual(ECOSYSTEM_UNRESOLVED_STATES, [
    "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED",
    "MISSING_FIRE_ALARM_COMPLIANCE_BASIS",
    "PANEL_SIZING_SNAPSHOT_REQUIRED",
    "COMPLEXITY_REVIEW_REQUIRED",
  ]);

  // Unresolved states never permit propagation.
  const unresolved = [
    resolveFireAlarmEcosystem({}), // MISSING_FIRE_ALARM_COMPLIANCE_BASIS
    resolveFireAlarmEcosystem({ complianceRegime: "UL/FM" }), // PANEL_SIZING_SNAPSHOT_REQUIRED
    resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 500 }), // COMPLEXITY_REVIEW_REQUIRED
    resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 2500 }), // LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED
  ];
  for (const decisionObject of unresolved) {
    assert.equal(ecosystemPropagationPermitted(decisionObject), false, `${decisionObject.decisionState} must forbid propagation`);
    assert.equal(decisionObject.compatibilityTarget, null, `${decisionObject.decisionState} must carry no compatibilityTarget`);
  }

  // The five resolved semantics of the mission, carried by the GOLDEN-5 state
  // model: RESOLVED_GAMEWELL_FCI and RESOLVED_SIMPLEX are EXPLICIT_PROJECT_ECOSYSTEM
  // targets of a governed approval, not separate states.
  const resolved = [
    resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 1500, complexity: "not-exceptional" }), // RESOLVED_FARENHYT
    resolveFireAlarmEcosystem({ complianceRegime: "LPCB/EN54/European" }), // RESOLVED_GENT
    resolveFireAlarmEcosystem({ explicitProjectEcosystem: RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI }), // RESOLVED_GAMEWELL_FCI route
    resolveFireAlarmEcosystem({ explicitProjectEcosystem: RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX }), // RESOLVED_SIMPLEX route
    resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 2200, approvedLargeSystemEcosystem: RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX }), // Rule D -> EXPLICIT_PROJECT_ECOSYSTEM
  ];
  for (const decisionObject of resolved) {
    assert.equal(ecosystemPropagationPermitted(decisionObject), true, `${decisionObject.decisionState} must permit propagation`);
    assert.ok(decisionObject.compatibilityTarget, `${decisionObject.decisionState} must carry a compatibilityTarget`);
  }

  // Classifier unit level (GOLDEN-6A sections 4, 5, 9, 17): a requirement
  // confirms ONLY when it carries an explicit governed scope declaration that
  // THIS item falls within. A bare "system AND category match" without the
  // declaration is the old permissive fallback and MUST now be fail-closed.
  const matchingItem = { id: "panel-1", system: "Fire Alarm", category: "Control Equipment" };
  const scopeConfirmed = classifyRequirementApplicability({
    requirement: {
      id: "u-scope",
      reviewStatus: "Approved",
      approvedForDownstream: 1,
      extractionIsCurrent: true,
      system: "Fire Alarm",
      category: "Control Equipment",
      // The explicit governed scope declaration -- the scope-ESTABLISHING
      // evidence (GOLDEN-6A section 7, EXPLICIT_REQUIREMENT_SCOPE).
      governedScope: { system: "Fire Alarm", category: "Control Equipment" },
    },
    item: matchingItem,
    ecosystem: null,
    evidence: null,
  });
  assert.equal(scopeConfirmed.status, "CONFIRMED_APPLICABLE");
  assert.equal(scopeConfirmed.basis, "SAME_EXPLICIT_SYSTEM_SCOPE");
  assert.equal(scopeConfirmed.scopeEvidence, EXPLICIT_REQUIREMENT_SCOPE_EVIDENCE, "the basis must be backed by an explicit governed scope declaration");
  assert.equal(scopeConfirmed.ruleId, "RULE_4_EXPLICIT_SYSTEM_SCOPE");
  assert.deepEqual(scopeConfirmed.declaredScope, { system: "Fire Alarm", category: "Control Equipment" });

  // GOLDEN-6A hardening: identical matching system/category classifications
  // WITHOUT the explicit governed scope declaration can never confirm.
  const noScopeFallback = classifyRequirementApplicability({
    requirement: { id: "u-scope-no-decl", reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: true, system: "Fire Alarm", category: "Control Equipment" },
    item: matchingItem,
    ecosystem: null,
    evidence: null,
  });
  assert.equal(noScopeFallback.status, "INSUFFICIENT_EVIDENCE", "same system + same category without governed scope evidence is fail-closed");
  assert.equal(noScopeFallback.ruleId, "RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE", "the no-evidence fallback carries the fail-closed rule id");

  const similarRejected = classifyRequirementApplicability({
    requirement: { id: "u-similar", reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: true, system: "Fire Alarm", category: "Other" },
    item: matchingItem,
    ecosystem: null,
    evidence: null,
  });
  assert.equal(similarRejected.status, "INSUFFICIENT_EVIDENCE", "text similarity without a governed scope match never confirms");
});

/* ------------------------------------------------------------------ *
 * Test 4 -- resolved ecosystem: one requirement propagates to seven items
 * ------------------------------------------------------------------ */
test("GOLDEN-6 4. resolved ecosystem propagates the single canonical compatibility requirement to all seven items (acceptance 2 + 10)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  const { plan, created } = planAndApply(raw, panelItems, { ecosystem: decision });

  const ecoClassification = plan.classifications.filter((entry) => entry.requirementId === REQ.ecosystem);
  assert.equal(plan.policyVersion, FACP_APPLICABILITY_POLICY_VERSION, "the plan records its governing policy version");
  assert.equal(ecoClassification.length, 7, "one requirement classified across all seven items");
  for (const entry of ecoClassification) {
    assert.equal(entry.status, "CONFIRMED_APPLICABLE", `${entry.itemId} ecosystem carrier must be confirmed`);
    assert.equal(entry.basis, "GOVERNED_ECOSYSTEM_DECISION");
  }
  assert.equal(plan.propagationPermitted, true, "resolved ecosystem permits propagation");

  const ecoLinks = plan.linksToCreate.filter((link) => link.requirementId === REQ.ecosystem);
  assert.equal(ecoLinks.length, 7, "one requirement yields exactly seven links");
  assert.equal(created, plan.linksToCreate.length, "every planned link was persisted");

  // Never seven requirements: the canonical compatibility requirement is ONE
  // row; only the links multiply.
  const ecoRequirementRows = raw.prepare("SELECT COUNT(*) AS n FROM technical_requirements WHERE id=?").get(REQ.ecosystem);
  assert.equal(ecoRequirementRows.n, 1, "the ecosystem requirement is never cloned");
  for (const panelId of panelItems) {
    const linked = linkedRequirementIds(raw, panelId);
    assert.ok(linked.includes(REQ.ecosystem), `${panelId} must carry the ecosystem link`);
  }
});

/* ------------------------------------------------------------------ *
 * Test 5 -- subset scope: only the named item is linked
 * ------------------------------------------------------------------ */
test("GOLDEN-6 5. drawing/system reference links only the explicitly named item (acceptance 1 + 3)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  const { plan, created } = planAndApply(raw, panelItems, { ecosystem: decision });

  const guiLinks = plan.linksToCreate.filter((link) => link.requirementId === REQ.mainGui);
  assert.equal(guiLinks.length, 1, "the GUI requirement is confirmed for exactly one item");
  assert.equal(guiLinks[0].itemId, "panel-1", "the drawing reference names the main FACP item");
  for (const item of panelContexts(panelItems).filter((entry) => entry.id !== "panel-1")) {
    const entry = plan.classifications.find((c) => c.requirementId === REQ.mainGui && c.itemId === item.id);
    assert.equal(entry?.status, "NOT_APPLICABLE", `${item.id} is explicitly outside the GUI requirement's scope`);
  }
  assert.equal(created, plan.linksToCreate.length);
  assert.ok(linkedRequirementIds(raw, "panel-1").includes(REQ.mainGui));
  assert.equal(linkedRequirementIds(raw, "panel-2").includes(REQ.mainGui), false);
});

/* ------------------------------------------------------------------ *
 * Test 6 -- full governed propagation changes the profile honestly
 * ------------------------------------------------------------------ */
test("GOLDEN-6 6. profile lifecycle: links appear in inputs, fingerprint moves, prior version supersedes (acceptance 12)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });

  const before = new Map();
  for (const panelId of panelItems) before.set(panelId, await regenerate(raw, panelId));

  const { created } = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.ok(created > 0, "the governed plan creates links");

  for (const panelId of panelItems) {
    const prior = before.get(panelId);
    assert.equal(prior.version_number, 1);

    const current = await regenerate(raw, panelId);
    const parsed = body(current);
    // New fingerprint (inputs changed) -> new version; prior superseded.
    assert.notEqual(current.input_fingerprint, prior.input_fingerprint, `${panelId} fingerprint must change`);
    assert.equal(current.version_number, 2, `${panelId} must gain profile version 2`);
    const historicalPrior = raw.prepare("SELECT * FROM requirement_profile_versions WHERE id=?").get(prior.id);
    assert.ok(historicalPrior.superseded_at, `${panelId} prior profile must be superseded (historical, never mutated)`);
    assert.equal(current.superseded_at, null, `${panelId} new profile is the current one`);

    // Compatibility arrives from the linked ecosystem requirement: the target
    // clears, and the relationship carries the resolved family.
    assert.ok(!missingFields(parsed).includes("compatibilityTarget"), `${panelId} compatibilityTarget must be satisfied`);
    const compatibility = parsed.compatibility || [];
    assert.ok(compatibility.some((entry) => /Honeywell Farenhyt/.test(entry.targetItem || "")),
      `${panelId} compatibility must carry the policy-resolved Honeywell Farenhyt target`);
  }
});

/* ------------------------------------------------------------------ *
 * Test 7 -- blocker-specific clearing: compatibility clears, the standard gate
 * does not, readiness is the engine's honest calculation (acceptance 14/15)
 * ------------------------------------------------------------------ */
test("GOLDEN-6 7. linkage clears only the compatibility blocker; standard stays missing and no standard/sizing is invented (negatives 4/6/7)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  for (const panelId of panelItems) await regenerate(raw, panelId);

  const { plan, created } = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.equal(plan.linksToCreate.length, 36, "per-item governed plan: 6 links for the main FACP, 5 for every building FACP");

  for (const panelId of panelItems) {
    const current = await regenerate(raw, panelId);
    const parsed = body(current);
    const missing = missingFields(parsed);
    // The compatibility blocker cleared.
    assert.ok(!missing.includes("compatibilityTarget"), `${panelId} compatibilityTarget must be cleared`);
    // The standard gate did NOT clear: the linked compliance requirement has
    // no approved requirement_standards child, so the profile honestly reports
    // `standard` still missing rather than inventing a standard.
    assert.ok(missing.includes("standard"), `${panelId} standard must still be reported missing -- a requirement link is not a standard fact`);
    assert.deepEqual(parsed.standards || [], [], `${panelId} must claim no standard`);
    // Blocker-specific proof: readiness is the engine's honest calculation.
    // standards dimension = 0 => overall < 80 => Ready with Warnings, and never
    // "Ready for Matching" -- link count and compatibility are not readiness.
    assert.equal(current.readiness_status, "Ready with Warnings",
      `${panelId} must be Ready with Warnings (standard gate ungated), not Ready for Matching`);
    // No inferred panel capacity / sizing: no capacity attribute, no sizing
    // snapshot row exists anywhere, and compatibilityTarget is the ecosystem
    // FAMILY, never a panel model number.
    const attributes = parsed.attributes || [];
    assert.equal(attributes.some((entry) => /capacity|loop|point|sizing/i.test(String(entry.name || ""))), false,
      `${panelId} must not infer panel capacity or sizing`);
    const compatibilityTargets = (parsed.compatibility || []).map((entry) => entry.targetItem || "");
    assert.ok(compatibilityTargets.every((target) => /ecosystem/i.test(target)),
      `${panelId} compatibility target must be the governed ecosystem family, not a model`);
  }
  assert.equal(created, plan.linksToCreate.length);
});

/* ------------------------------------------------------------------ *
 * Test 8 -- idempotency: replanning and regenerating are no-ops
 * ------------------------------------------------------------------ */
test("GOLDEN-6 8. replanning creates no duplicate links and regeneration without input change is idempotent (acceptance 9 + 13)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  for (const panelId of panelItems) await regenerate(raw, panelId);

  const first = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.equal(first.created, first.plan.linksToCreate.length, "first plan applies fully");
  const firstVersion = new Map();
  for (const panelId of panelItems) {
    const current = await regenerate(raw, panelId);
    firstVersion.set(panelId, { id: current.id, version: current.version_number, fingerprint: current.input_fingerprint });
  }

  // Re-plan with the existing Confirmed links in scope: zero new links.
  const second = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.equal(second.plan.linksToCreate.length, 0, "replanning the same governed plan produces no new links");
  assert.equal(second.created, 0, "no rows are inserted a second time");

  // Re-run profile generation with unchanged inputs: same profile, no new row.
  for (const panelId of panelItems) {
    const again = await executeRequirementProfile(envFor(raw), { itemId: panelId, userId: OWNER });
    assert.equal(again.idempotent, true, `${panelId} regeneration without input change must be idempotent`);
    const current = await currentRequirementProfile(d1(raw), panelId);
    assert.equal(current.id, firstVersion.get(panelId).id, `${panelId} profile identity must not change`);
    assert.equal(current.version_number, firstVersion.get(panelId).version, `${panelId} no artificial version bump`);
    assert.equal(current.input_fingerprint, firstVersion.get(panelId).fingerprint, `${panelId} fingerprint must be stable`);
  }
});

/* ------------------------------------------------------------------ *
 * Test 9 -- unresolved ecosystem: no compatibility propagation, no temporary
 * target (acceptance 11 + negative 3)
 * ------------------------------------------------------------------ */
test("GOLDEN-6 9. unresolved ecosystem forbids propagation and the profile stays blocked", async () => {
  const { raw, panelItems } = await seedProject({ ecosystem: "none" });
  for (const panelId of panelItems) {
    const profile = await regenerate(raw, panelId);
    const parsed = body(profile);
    assert.ok(missingFields(parsed).includes("compatibilityTarget"), `${panelId} stays blocked`);
    assert.equal(profile.readiness_status, "Missing Critical Information", `${panelId} readiness must remain blocked`);
  }

  // The planner is given the carrier requirement (as a synthetic candidate) and
  // an ABSENT decision: the ecosystem gate refuses it -- it is never a
  // temporary compatibility target and never a link.
  const requirements = readRequirements(raw);
  const carrier = {
    id: REQ.ecosystem,
    reviewStatus: "Approved",
    approvedForDownstream: 1,
    extractionIsCurrent: true,
    system: "Fire Alarm",
    category: "Control Equipment",
    ecosystemCarrier: true,
  };
  const plan = planApplicabilityLinks({
    requirements: [...requirements, carrier],
    items: panelContexts(panelItems),
    ecosystem: null,
    evidenceByRequirement: { [REQ.ecosystem]: { base: "GOVERNED_ECOSYSTEM_DECISION" } },
    existingLinks: existingLinkRows(raw),
  });
  assert.equal(plan.propagationPermitted, false, "no decision => no propagation");
  assert.equal(plan.linksToCreate.filter((link) => link.requirementId === REQ.ecosystem).length, 0,
    "the compatibility requirement must never be linked under an unresolved ecosystem");
  for (const entry of plan.classifications.filter((c) => c.requirementId === REQ.ecosystem)) {
    assert.equal(entry.status, "NOT_APPLICABLE");
    assert.equal(entry.propagationForbidden, true, `${entry.itemId}: propagation explicitly forbidden`);
    assert.equal(entry.ruleId, "RULE_1B_UNRESOLVED_ECOSYSTEM_NO_PROPAGATION");
  }
});

/* ------------------------------------------------------------------ *
 * Test 10 -- ambiguous requirement: surfaced for review, resolved by a
 * governed human decision (mission section 19)
 * ------------------------------------------------------------------ */
test("GOLDEN-6 10. ambiguous applicability is surfaced, never auto-linked, then linked only through a recorded human decision", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  for (const panelId of panelItems) await regenerate(raw, panelId);

  const first = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.equal(first.plan.linksToCreate.some((link) => link.requirementId === REQ.ambiguous), false,
    "ambiguous requirement must not auto-link");
  assert.equal(first.plan.reviewPairs.every((pair) => pair.requirementId === REQ.ambiguous), true);
  assert.equal(first.plan.reviewPairs.length, 7, "all seven items surface the ambiguous requirement for engineering review");

  // The auto-governed plan is applied first; profile v2 records those inputs.
  const afterAuto = await regenerate(raw, "panel-2");
  assert.equal(afterAuto.version_number, 2, "panel-2 moves from v1 (pre-link) to v2 (auto-governed plan)");

  // A governed human applicability decision is recorded through the existing
  // authority model: the decision names the requirement, the items, the why,
  // the scope, and the authority. It now plans as CONFIRMED -- one requirement,
  // seven links.
  const humanDecision = {
    base: "HUMAN_ENGINEERING_DECISION",
    scopeItemIds: panelItems,
    authority: OWNER,
    note: "Approved applicability decision: the panel-wise and building-wise Cause and Effect Matrix obligation governs every Fire Alarm Control Panel.",
  };
  const second = planAndApply(raw, panelItems, { ecosystem: decision, evidence: { [REQ.ambiguous]: humanDecision } });
  const ambiguityLinks = second.plan.linksToCreate.filter((link) => link.requirementId === REQ.ambiguous);
  assert.equal(ambiguityLinks.length, 7, "one requirement + seven links after the human decision");
  for (const link of ambiguityLinks) assert.equal(link.basis, "HUMAN_ENGINEERING_DECISION");
  assert.equal(second.created, 7, "the seven decided links were persisted");

  const ambiguousCount = raw.prepare("SELECT COUNT(*) AS n FROM technical_requirements WHERE id=?").get(REQ.ambiguous);
  assert.equal(ambiguousCount.n, 1, "the human decision never clones the requirement");

  // The decision changes the genuine inputs: fingerprint moves, version bumps.
  const current = await regenerate(raw, "panel-2");
  assert.equal(current.version_number, 3, "panel-2 profile moves from v1 -> v2 (auto plan) -> v3 (human decision)");
  const parsed = body(current);
  assert.ok((parsed.applicableRequirements || []).some((entry) => /Cause and Effect Matrix/i.test(entry.normalizedRequirement || entry.originalText || "")),
    "the human-decided Cause & Effect requirement now appears in the profile inputs");
});

/* ------------------------------------------------------------------ *
 * Test 11 -- old matching runs stay pinned to their historical profile
 * ------------------------------------------------------------------ */
test("GOLDEN-6 11. an old matching run is never re-pointed after the profile regenerates (acceptance 16 + negative 5)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });

  // Pre-link profile version 1 for every panel; capture panel-1's before
  // applying the governed plan.
  const pre = new Map();
  for (const panelId of panelItems) pre.set(panelId, await regenerate(raw, panelId));
  const oldProfile = pre.get("panel-1");

  // An old matching run pinned to the pre-link profile version.
  raw.prepare(`INSERT INTO product_match_runs
    (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,candidate_count,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("run-panel-1-old", PROJECT, "panel-1", oldProfile.id, oldProfile.version_number, "Completed",
      oldProfile.input_fingerprint, "e1", "r1", "s1", "m1", "Project", "{}", 0, OWNER);

  const { created } = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.ok(created > 0);
  const current = await regenerate(raw, "panel-1");
  assert.equal(current.version_number, 2, "panel-1 gains profile version 2");

  const run = raw.prepare("SELECT * FROM product_match_runs WHERE id='run-panel-1-old'").get();
  assert.equal(run.requirement_profile_version_id, oldProfile.id, "the old run still references the historical profile version");
  assert.equal(run.input_fingerprint, oldProfile.input_fingerprint, "the old run's captured fingerprint is unmutated");
  assert.notEqual(current.input_fingerprint, oldProfile.input_fingerprint, "new fingerprint differs from the historical one");
  const historical = raw.prepare("SELECT * FROM requirement_profile_versions WHERE id=?").get(oldProfile.id);
  assert.ok(historical.superseded_at, "the historical profile row still exists and is superseded, never mutated");
  // A fresh run would target the new profile version (genuine re-run required).
  assert.equal(current.id === oldProfile.id, false);
});

/* ------------------------------------------------------------------ *
 * Test 12 -- the seven-item post-state matrix
 * ------------------------------------------------------------------ */
test("GOLDEN-6 12. post-state inventory: every item carries only its governed links; blocked rows stay unlinked (acceptance 3/5/6/7)", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  for (const panelId of panelItems) await regenerate(raw, panelId);
  const { plan, created } = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.equal(created, plan.linksToCreate.length);

  for (const panelId of panelItems) {
    const linked = linkedRequirementIds(raw, panelId).sort();
    const expected = [REQ.ecosystem, REQ.facpDisplay, REQ.panelSoftware, REQ.networkPanels, REQ.active].sort();
    if (panelId === "panel-1") expected.push(REQ.mainGui);
    expected.sort();
    assert.deepEqual(linked, expected, `${panelId} carries exactly its governed links`);
  }

  // Everything that must not link, links for nobody.
  for (const requirementId of [REQ.slc, REQ.wiring, REQ.voice, REQ.similar, REQ.draft, REQ.rejected, REQ.superseded]) {
    const rows = raw.prepare(
      "SELECT COUNT(*) AS n FROM boq_requirement_links WHERE requirement_id=? AND status='Confirmed' AND superseded_at IS NULL",
    ).get(requirementId);
    assert.equal(rows.n, 0, `${requirementId} must have zero active confirmed links`);
  }

  // Post-state readiness and the remaining gate, per item.
  for (const panelId of panelItems) {
    const current = await regenerate(raw, panelId);
    const parsed = body(current);
    assert.ok(!missingFields(parsed).includes("compatibilityTarget"), `${panelId} compatibility resolved`);
    assert.equal(current.readiness_status, "Ready with Warnings", `${panelId} honest engine readiness`);
  }
});

/* ------------------------------------------------------------------ *
 * Test 13 -- link count and compatibility are never readiness, and no cloning
 * (negatives 4 and 8 in one place)
 * ------------------------------------------------------------------ */
test("GOLDEN-6 13. requirement links are not readiness, and propagated requirements are never cloned", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  for (const panelId of panelItems) await regenerate(raw, panelId);
  const { created } = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.ok(created > 0);

  const totalActiveLinks = raw.prepare(
    "SELECT COUNT(*) AS n FROM boq_requirement_links WHERE project_id=? AND status='Confirmed' AND superseded_at IS NULL",
  ).get(PROJECT).n;
  assert.ok(totalActiveLinks >= 36, `the governed plan raised the link count to ${totalActiveLinks}`);

  // ...and yet no panel is "Ready for Matching": the standard gate is
  // genuinely unsatisfied. Link count is not readiness.
  for (const panelId of panelItems) {
    const current = await regenerate(raw, panelId);
    assert.notEqual(current.readiness_status, "Ready for Matching", `${panelId} many links + resolved compatibility do not imply readiness`);
  }

  // One requirement, seven links; the requirement row count never multiplies.
  for (const requirementId of [REQ.ecosystem, REQ.facpDisplay, REQ.networkPanels, REQ.active]) {
    const rows = raw.prepare("SELECT COUNT(*) AS n FROM technical_requirements WHERE id=?").get(requirementId);
    assert.equal(rows.n, 1, `${requirementId} is one requirement`);
  }
  const ecosystemLinks = raw.prepare(
    "SELECT COUNT(*) AS n FROM boq_requirement_links WHERE requirement_id=? AND status='Confirmed' AND superseded_at IS NULL",
  ).get(REQ.ecosystem).n;
  assert.equal(ecosystemLinks, 7, "the canonical compatibility requirement links to exactly all seven items");
});

/* ================================================================== *
 * GOLDEN-6A -- FACP APPLICABILITY FAIL-CLOSED HARDENING
 *
 * Core invariant (mission section 3):
 *   Matching classifications VALIDATE applicability.
 *   They do not ESTABLISH applicability.
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * GOLDEN-6A 14 -- matching classifications never establish applicability
 * (mission sections 2, 5, 8, 9; acceptance rows 1-4; negatives 1-4)
 * ------------------------------------------------------------------ */
test("GOLDEN-6A 14. same system/category/product-family/description without governed scope evidence is INSUFFICIENT_EVIDENCE, never a link", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  const matchingItem = { id: "panel-1", system: "Fire Alarm", category: "Control Equipment", productFamily: "Fire Alarm Control Panel" };

  const baseRequirement = {
    reviewStatus: "Approved",
    approvedForDownstream: 1,
    extractionIsCurrent: true,
    system: "Fire Alarm",
    category: "Control Equipment",
    productFamily: "Fire Alarm Control Panel",
    text: "The Fire Alarm Control Panel shall provide a graphic annunciator display for the operator workstation.", // identical text below
  };
  const identicalTextItem = { ...matchingItem, description: baseRequirement.text };

  const cases = [
    {
      label: "same system only",
      requirement: { ...baseRequirement, category: "Other" },
      item: matchingItem,
    },
    {
      label: "same system + same category (the eliminated permissive fallback)",
      requirement: { ...baseRequirement },
      item: matchingItem,
    },
    {
      label: "same product family (validation attribute only)",
      requirement: { ...baseRequirement },
      item: matchingItem,
    },
    {
      label: "identical description (similarity is never non-authoritative-relevant)",
      requirement: { ...baseRequirement },
      item: identicalTextItem,
    },
    {
      label: "generic-looking text with no project-wide evidence",
      requirement: { ...baseRequirement, text: "All fire alarm equipment shall comply with the local authority requirements." },
      item: matchingItem,
    },
  ];
  for (const { label, requirement, item } of cases) {
    const result = classifyRequirementApplicability({
      requirement: { id: "u-6a-no-scope", ...requirement },
      item,
      ecosystem: null,
      evidence: null,
    });
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE", `${label}: no governed scope evidence can never confirm`);
    assert.equal(result.ruleId, "RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE", `${label}: fail-closed rule id`);
    assert.ok(!result.basis, `${label}: no evidence basis may be fabricated`);
  }

  // Evidence that CLAIMS an explicit scope but has no declaration behind it is
  // also fail-closed (mission section 4: valid only when the requirement
  // itself carries an explicit governed scope).
  const claimedOnly = classifyRequirementApplicability({
    requirement: { id: "u-6a-claimed", ...baseRequirement },
    item: matchingItem,
    ecosystem: null,
    evidence: { base: "SAME_EXPLICIT_SYSTEM_SCOPE" },
  });
  assert.equal(claimedOnly.status, "INSUFFICIENT_EVIDENCE", "a claimed SAME_EXPLICIT_SYSTEM_SCOPE base with no declaration cannot confirm");

  // PLAN LEVEL: a synthetic requirement identical in every classification
  // attribute to the items, with no declaration and no evidence, plans ZERO
  // links across all seven items.
  const strippedMatchingRequirement = {
    id: "u-6a-synthetic-match",
    reviewStatus: "Approved",
    approvedForDownstream: 1,
    extractionIsCurrent: true,
    system: "Fire Alarm",
    category: "Control Equipment",
    governedScope: null,
  };
  const plan = planApplicabilityLinks({
    requirements: [...readRequirements(raw), strippedMatchingRequirement],
    items: panelContexts(panelItems),
    ecosystem: decision,
    evidenceByRequirement: FACP_EVIDENCE,
    existingLinks: existingLinkRows(raw),
  });
  const syntheticClassifications = plan.classifications.filter((entry) => entry.requirementId === strippedMatchingRequirement.id);
  assert.equal(syntheticClassifications.length, 7);
  for (const entry of syntheticClassifications) {
    assert.equal(entry.status, "INSUFFICIENT_EVIDENCE", `${entry.itemId}: matching classifications establish nothing`);
    assert.equal(entry.ruleId, APPLICABILITY_RULES.NO_GOVERNED_APPLICABILITY_EVIDENCE);
  }
  assert.equal(
    plan.linksToCreate.some((link) => link.requirementId === strippedMatchingRequirement.id),
    false,
    "zero planned links for a classification-identical requirement without governed scope",
  );
});

/* ------------------------------------------------------------------ *
 * GOLDEN-6A 15 -- explicit governed scope: positive match and governed
 * out-of-scope (mission sections 4, 10; acceptance rows 5-6, 9-10)
 * ------------------------------------------------------------------ */
test("GOLDEN-6A 15. explicit governed scope declares applicability; item classification only validates it, and scope is never broadened", async () => {
  const { raw, panelItems } = await seedProject({ ecosystem: "resolved" });
  const declared = {
    id: "u-6a-declared",
    reviewStatus: "Approved",
    approvedForDownstream: 1,
    extractionIsCurrent: true,
    system: "Fire Alarm",
    category: "Control Equipment",
    governedScope: { system: "Fire Alarm", category: "Control Equipment" },
  };

  // Positive: item falls within the DECLARED scope.
  const inside = classifyRequirementApplicability({
    requirement: declared,
    item: { id: "panel-1", system: "Fire Alarm", category: "Control Equipment" },
    ecosystem: null,
    evidence: null,
  });
  assert.equal(inside.status, "CONFIRMED_APPLICABLE");
  assert.equal(inside.basis, "SAME_EXPLICIT_SYSTEM_SCOPE");
  assert.equal(inside.scopeEvidence, EXPLICIT_REQUIREMENT_SCOPE_EVIDENCE);
  assert.equal(inside.ruleId, "RULE_4_EXPLICIT_SYSTEM_SCOPE");
  assert.deepEqual(inside.declaredScope, { system: "Fire Alarm", category: "Control Equipment" });

  // Out-of-scope: declared scope is NOT broadened to cover this category.
  const outside = classifyRequirementApplicability({
    requirement: declared,
    item: { id: "det-1", system: "Fire Alarm", category: "Detection Devices" },
    ecosystem: null,
    evidence: null,
  });
  assert.equal(outside.status, "NOT_APPLICABLE", "a category outside the declared scope is governed out-of-scope");
  assert.equal(outside.ruleId, "RULE_4B_EXPLICIT_SCOPE_MISMATCH");

  // The same outcome when the base is supplied as evidence: the declaration
  // is what validates it.
  const insideWithEvidence = classifyRequirementApplicability({
    requirement: declared,
    item: { id: "panel-1", system: "Fire Alarm", category: "Control Equipment" },
    ecosystem: null,
    evidence: { base: "SAME_EXPLICIT_SYSTEM_SCOPE" },
  });
  assert.equal(insideWithEvidence.status, "CONFIRMED_APPLICABLE");
  assert.equal(insideWithEvidence.basis, "SAME_EXPLICIT_SYSTEM_SCOPE");

  // PLAN LEVEL: two requirements with different declared scopes land only on
  // the items their own declarations cover.
  const detectionRequirement = {
    id: "u-6a-detection",
    reviewStatus: "Approved",
    approvedForDownstream: 1,
    extractionIsCurrent: true,
    system: "Fire Alarm",
    category: "Detection Devices",
    governedScope: { system: "Fire Alarm", category: "Detection Devices" },
  };
  const items = [...panelContexts(panelItems), { id: "det-1", system: "Fire Alarm", category: "Detection Devices" }];
  const scopePlan = planApplicabilityLinks({
    requirements: [declared, detectionRequirement],
    items,
    ecosystem: null,
    evidenceByRequirement: {},
    existingLinks: [],
  });
  const confirmedPairs = scopePlan.linksToCreate.map((link) => `${link.requirementId}|${link.itemId}`).sort();
  assert.deepEqual(confirmedPairs, [
    "u-6a-declared|panel-1",
    "u-6a-declared|panel-2",
    "u-6a-declared|panel-3",
    "u-6a-declared|panel-4",
    "u-6a-declared|panel-5",
    "u-6a-declared|panel-6",
    "u-6a-declared|panel-7",
    "u-6a-detection|det-1",
  ], "each requirement confirms only on items within its own declared scope");

  // Human engineering decision scopes a SUBSET (acceptance row 10): the
  // resolved-ecosystem fixture's ambiguity requirement becomes confirmed only
  // on the recorded items, and is SUBSET_EXCLUDED elsewhere.
  const subset = planApplicabilityLinks({
    requirements: readRequirements(raw).filter((r) => r.id === REQ.ambiguous),
    items: panelContexts(panelItems),
    ecosystem: null,
    evidenceByRequirement: {
      [REQ.ambiguous]: { base: "HUMAN_ENGINEERING_DECISION", scopeItemIds: ["panel-1", "panel-2"] },
    },
    existingLinks: [],
  });
  assert.deepEqual(
    subset.linksToCreate.map((link) => link.itemId).sort(),
    ["panel-1", "panel-2"],
    "the human decision confirms only on its recorded scope",
  );
  for (const entry of subset.classifications.filter((e) => !["panel-1", "panel-2"].includes(e.itemId))) {
    assert.equal(entry.status, "NOT_APPLICABLE");
    assert.equal(entry.ruleId, "RULE_9_SUBSET_SCOPE_EXCLUDES_ITEM");
  }

  // Explicit BOQ relationship scoping a non-empty SUBSET (acceptance row 9):
  // confirmed only on the named items, SUBSET_EXCLUDED elsewhere.
  const relationshipSubset = planApplicabilityLinks({
    requirements: readRequirements(raw).filter((r) => r.id === REQ.voice),
    items: panelContexts(panelItems),
    ecosystem: null,
    evidenceByRequirement: {
      [REQ.voice]: { base: "EXPLICIT_BOQ_RELATIONSHIP", scopeItemIds: ["panel-3", "panel-4"] },
    },
    existingLinks: [],
  });
  assert.deepEqual(
    relationshipSubset.linksToCreate.map((link) => link.itemId).sort(),
    ["panel-3", "panel-4"],
    "the BOQ relationship confirms only on its explicitly named subset",
  );
  for (const entry of relationshipSubset.classifications.filter((e) => !["panel-3", "panel-4"].includes(e.itemId))) {
    assert.equal(entry.status, "NOT_APPLICABLE");
    assert.equal(entry.ruleId, "RULE_9_SUBSET_SCOPE_EXCLUDES_ITEM");
  }
});

/* ------------------------------------------------------------------ *
 * GOLDEN-6A 16 -- ecosystem RESULT vs decision AUTHORITY, and the
 * candidate list never becomes a target (mission sections 13, 14;
 * negatives 6-7)
 * ------------------------------------------------------------------ */
test("GOLDEN-6A 16. the ecosystem result and its decision authority are distinct; unresolved candidate lists never become compatibility targets", async () => {
  // The GOLDEN-5 model already separates RESULT from AUTHORITY: decision
  // objects carry decisionState/resolvedEcosystem/compatibilityTarget AND an
  // explicit `basis` from the AUTHORITY_BASES taxonomy. The SAME state name
  // never encodes the authority.
  const gamewellViaProjectRequirement = resolveFireAlarmEcosystem({ explicitProjectEcosystem: RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI });
  const gamewellViaHumanDecision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM", preliminaryTotalPoints: 2200, approvedLargeSystemEcosystem: RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI,
  });
  assert.deepEqual([...ECOSYSTEM_DECISION_AUTHORITIES], [...AUTHORITY_BASES], "the GOLDEN-6A authority surface mirrors GOLDEN-5's AUTHORITY_BASES");

  // Same result, same state, different authority: EXPLICIT_PROJECT_ECOSYSTEM
  // reached via Rule A (PROJECT_REQUIREMENT) and Rule D (HUMAN_ENGINEERING_DECISION).
  assert.equal(gamewellViaProjectRequirement.decisionState, "EXPLICIT_PROJECT_ECOSYSTEM");
  assert.equal(gamewellViaHumanDecision.decisionState, "EXPLICIT_PROJECT_ECOSYSTEM");
  assert.equal(gamewellViaProjectRequirement.resolvedEcosystem, RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI);
  assert.equal(gamewellViaHumanDecision.resolvedEcosystem, RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI);
  assert.equal(gamewellViaProjectRequirement.basis, "PROJECT_REQUIREMENT");
  assert.equal(gamewellViaHumanDecision.basis, "HUMAN_ENGINEERING_DECISION");
  assert.notEqual(gamewellViaProjectRequirement.basis, gamewellViaHumanDecision.basis, "authority is never encoded in the state name");

  // The authority is a governed basis from the single taxonomy, not an ad-hoc label.
  assert.ok(AUTHORITY_BASES.includes(gamewellViaHumanDecision.basis));

  // GOLDEN-6A plan SURFACE: the applicability policy must not flatten away the
  // authority the way the GOLDEN-6 summary did.
  const { raw, panelItems } = await seedProject({ ecosystem: "resolved" });
  const requirements = readRequirements(raw);
  const items = panelContexts(panelItems);
  const planA = planApplicabilityLinks({ requirements, items, ecosystem: gamewellViaProjectRequirement, evidenceByRequirement: FACP_EVIDENCE, existingLinks: [] });
  const planD = planApplicabilityLinks({ requirements, items, ecosystem: gamewellViaHumanDecision, evidenceByRequirement: FACP_EVIDENCE, existingLinks: [] });
  assert.equal(planA.ecosystem.decisionState, "EXPLICIT_PROJECT_ECOSYSTEM");
  assert.equal(planD.ecosystem.decisionState, planA.ecosystem.decisionState, "same decision state");
  assert.equal(planA.ecosystem.resolvedEcosystem, RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI);
  assert.equal(planD.ecosystem.resolvedEcosystem, planA.ecosystem.resolvedEcosystem, "same resolved result");
  assert.equal(planA.ecosystem.decisionAuthority, "PROJECT_REQUIREMENT");
  assert.equal(planD.ecosystem.decisionAuthority, "HUMAN_ENGINEERING_DECISION");
  assert.notEqual(planA.ecosystem.decisionAuthority, planD.ecosystem.decisionAuthority, "result != authority");
  const carrierInA = planA.classifications.find((e) => e.requirementId === REQ.ecosystem && e.itemId === "panel-1");
  const carrierInD = planD.classifications.find((e) => e.requirementId === REQ.ecosystem && e.itemId === "panel-1");
  assert.equal(carrierInA.decisionAuthority, "PROJECT_REQUIREMENT");
  assert.equal(carrierInD.decisionAuthority, "HUMAN_ENGINEERING_DECISION", "carrier classifications carry the authority too");
  assert.equal(carrierInD.compatibilityTarget, RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI);

  // Resolution target is a FAMILY, never an exact panel model (negative 7).
  assert.equal(RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI, "Honeywell Gamewell-FCI Fire Alarm ecosystem");
  assert.ok(/ecosystem/i.test(carrierInD.compatibilityTarget), "the compatibility target is a family label, not a panel model");

  // Unresolved LARGE-UL/FM evaluation: two candidates exist but NEITHER is a
  // target, so no compatibility row may ever be written (negative 6).
  const large = resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints: 2500 });
  assert.equal(large.decisionState, "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED");
  assert.equal(large.candidates.length, 2);
  assert.equal(large.compatibilityTarget, null, "candidates never become a compatibility target");
  assert.equal(large.basis, null, "an unresolved evaluation has no decision authority yet");
  assert.equal(ecosystemPropagationPermitted(large), false);
  const planLarge = planApplicabilityLinks({ requirements, items, ecosystem: large, evidenceByRequirement: FACP_EVIDENCE, existingLinks: [] });
  assert.equal(planLarge.propagationPermitted, false);
  assert.equal(planLarge.ecosystem.compatibilityTarget, null);
  const largeCarrier = planLarge.classifications.find((e) => e.requirementId === REQ.ecosystem && e.itemId === "panel-1");
  assert.equal(largeCarrier.status, "NOT_APPLICABLE");
  assert.equal(largeCarrier.propagationForbidden, true);
});

/* ------------------------------------------------------------------ *
 * GOLDEN-6A 17 -- evidence-backed confirmations only; no copying between
 * similar items, and stripped declarations collapse (mission sections 15
 * (rows 7-9), 16 (negative 5))
 * ------------------------------------------------------------------ */
test("GOLDEN-6A 17. confirmed links are evidence-backed: stripping the governed scope declarations collapses the fallback pair, and similar items never copy each other's links", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });

  // Full-governed run: the two declaration-backed requirements confirm.
  const declaredRun = planApplicabilityLinks({
    requirements: readRequirements(raw),
    items: panelContexts(panelItems),
    ecosystem: decision,
    evidenceByRequirement: FACP_EVIDENCE,
    existingLinks: existingLinkRows(raw),
  });
  for (const id of [REQ.facpDisplay, REQ.panelSoftware]) {
    const entries = declaredRun.classifications.filter((e) => e.requirementId === id);
    assert.equal(entries.filter((e) => e.status === "CONFIRMED_APPLICABLE").length, 7, `${id} confirms on all seven via its governed scope declaration`);
    assert.ok(entries.every((e) => e.scopeEvidence === "EXPLICIT_REQUIREMENT_SCOPE"), `${id} confirmations are backed by an explicit declaration`);
  }

  // Stripped run: same requirement rows WITHOUT the declaration (what the old
  // permissive fallback would have confirmed on matching classifications)
  // collapse to INSUFFICIENT_EVIDENCE; genuine governed evidence survives.
  const stripped = planApplicabilityLinks({
    requirements: readRequirements(raw).map((r) => ({ ...r, governedScope: null })),
    items: panelContexts(panelItems),
    ecosystem: decision,
    evidenceByRequirement: FACP_EVIDENCE,
    existingLinks: existingLinkRows(raw),
  });
  const smallestConfirmed = (id) => stripped.classifications.filter((e) => e.requirementId === id && e.status === "CONFIRMED_APPLICABLE").length;
  assert.equal(smallestConfirmed(REQ.facpDisplay), 0, "without the declaration, facpDisplay cannot confirm");
  assert.equal(smallestConfirmed(REQ.panelSoftware), 0, "without the declaration, panelSoftware cannot confirm");
  assert.equal(smallestConfirmed(REQ.networkPanels), 7, "project-wide evidence still confirms");
  assert.equal(smallestConfirmed(REQ.active), 7, "project-wide compliance evidence still confirms");
  assert.equal(smallestConfirmed(REQ.mainGui), 1, "drawing reference still scopes the main panel only");
  assert.equal(
    stripped.linksToCreate.filter((l) => [REQ.facpDisplay, REQ.panelSoftware].includes(l.requirementId)).length,
    0,
    "the fallback pair plans zero links when its declaration is absent",
  );

  // Negative 5: many similar FACP items never copy another item's links. The
  // main panel carries mainGui ONLY because a governed drawing reference
  // names it; panels 2-7 never inherit it simply by being similar items.
  const mainGuiByItem = declaredRun.classifications
    .filter((e) => e.requirementId === REQ.mainGui)
    .map((e) => `${e.itemId}:${e.status}`)
    .sort();
  assert.deepEqual(mainGuiByItem, [
    "panel-1:CONFIRMED_APPLICABLE",
    "panel-2:NOT_APPLICABLE",
    "panel-3:NOT_APPLICABLE",
    "panel-4:NOT_APPLICABLE",
    "panel-5:NOT_APPLICABLE",
    "panel-6:NOT_APPLICABLE",
    "panel-7:NOT_APPLICABLE",
  ], "the drawing-scoped requirement lands on the main panel only, never copied");

  // The linked-set difference between panel-1 and panel-2 is exactly the
  // governed evidence-borne difference -- nothing is copied.
  const panel1Links = new Set(declaredRun.linksToCreate.filter((l) => l.itemId === "panel-1").map((l) => l.requirementId));
  const panel2Links = new Set(declaredRun.linksToCreate.filter((l) => l.itemId === "panel-2").map((l) => l.requirementId));
  const diff = [...panel1Links].filter((id) => !panel2Links.has(id));
  assert.deepEqual(diff, [REQ.mainGui], "the only difference is the evidence-scoped main GUI requirement");
});

/* ------------------------------------------------------------------ *
 * GOLDEN-6A 18 -- GOLDEN-6 regression under the hardened rules
 * (mission section 17; deliverables 6-7)
 * ------------------------------------------------------------------ */
test("GOLDEN-6A 18. GOLDEN-6 lifecycle stays green under the hardened policy and every confirmation is traceable", async () => {
  const { raw, panelItems, decision } = await seedProject({ ecosystem: "resolved" });
  assert.equal(FACP_APPLICABILITY_POLICY_VERSION, "facp-requirement-applicability-policy-1.1.0", "the hardened policy carries its own version");

  const { plan, created } = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.equal(created, plan.linksToCreate.length);
  assert.ok(created >= 36, "the governed plan still closes the linkage gap");

  // Every confirmation carries a traceable governed basis.
  for (const entry of plan.classifications.filter((e) => e.status === "CONFIRMED_APPLICABLE")) {
    assert.ok(
      ["GOVERNED_ECOSYSTEM_DECISION", "SAME_EXPLICIT_SYSTEM_SCOPE", "SAME_DRAWING_SYSTEM_REFERENCE", "APPROVED_PROJECT_WIDE_REQUIREMENT"].includes(entry.basis),
      `${entry.requirementId}|${entry.itemId} has a governed evidence basis`,
    );
  }

  // The previously-fallback pair now declares its scope (section 17 fixture
  // update) and confirms with the declaration recorded on the classification.
  const fallbackPair = [REQ.facpDisplay, REQ.panelSoftware];
  for (const id of fallbackPair) {
    const entry = plan.classifications.find((e) => e.requirementId === id && e.itemId === "panel-1");
    assert.equal(entry.basis, "SAME_EXPLICIT_SYSTEM_SCOPE");
    assert.equal(entry.ruleId, "RULE_4_EXPLICIT_SYSTEM_SCOPE");
    assert.equal(entry.scopeEvidence, "EXPLICIT_REQUIREMENT_SCOPE");
    assert.deepEqual(entry.declaredScope, { system: "Fire Alarm", category: "Control Equipment" });
  }

  // Ecosystem carrier surfaces result AND authority separately.
  const carrier = plan.classifications.find((e) => e.requirementId === REQ.ecosystem && e.itemId === "panel-1");
  assert.equal(carrier.basis, "GOVERNED_ECOSYSTEM_DECISION");
  assert.equal(carrier.resolvedEcosystem, decision.resolvedEcosystem);
  assert.equal(carrier.compatibilityTarget, decision.compatibilityTarget);
  assert.equal(carrier.decisionAuthority, "ENGINEERING_POLICY_RESOLUTION", "the fixture resolves Farenhyt by engineering policy resolution");
  assert.equal(plan.ecosystem.decisionAuthority, "ENGINEERING_POLICY_RESOLUTION");

  // Blocked rows stay unlinked under the hardened rules.
  for (const requirementId of [REQ.slc, REQ.wiring, REQ.voice, REQ.similar]) {
    const entries = plan.classifications.filter((e) => e.requirementId === requirementId);
    assert.ok(entries.every((e) => ["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE"].includes(e.status)), `${requirementId} never receives a link`);
  }

  // Idempotency under the hardened policy: a second run plans and creates
  // nothing new, and readiness honesty is preserved.
  const second = planAndApply(raw, panelItems, { ecosystem: decision });
  assert.equal(second.created, 0, "re-running the plan is idempotent");
  for (const panelId of panelItems) {
    const current = await regenerate(raw, panelId);
    assert.notEqual(current.readiness_status, "Ready for Matching", `${panelId} many governed links are still not readiness`);
  }
});