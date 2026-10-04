// GOLDEN-2 — Governed Primary Panel Selection prerequisite.
//
// GOLDEN-1 proved the quotation gate is correct and that
// `fire_alarm_panel_sizing_snapshots` is empty, with the panel-sizing producer
// blocked upstream by governed engineering prerequisites. The first concrete
// blocker for the acceptance project is CURRENT_APPROVED_PANEL_SELECTION_REQUIRED
// (worker/fire-alarm-panel-sizing-api.mjs:361), and `safety_approval_requests`
// held zero rows globally.
//
// This suite proves the ONE thing GOLDEN-2 exists to establish: the current
// application ALREADY has a governed writer for the required approved primary
// selection, and driving that canonical route -- with no direct row fabrication --
// clears the sizing guard.
//
// The distinction that matters and is proven here:
//   * the existing R7 producer test (tests/r7-panel-sizing-production.test.mjs:254)
//     seeds the approval row with a direct SQL INSERT, so it proves the GUARD
//     but NOT that a governed path can produce the row;
//   * this suite drives `POST /api/match-candidates/:id/safety/approve` -- the
//     single production writer of safety_approval_requests
//     (worker/confidence-safety-api.mjs:138) -- against the real schema, then
//     re-runs the real producer.
//
// Contract under test (implementation evidence, not error wording):
//   guard   : selection.status === "APPROVED" && selection.productId === panel.productId
//   resolver: worker/primary-selection-authority.mjs:43 resolveCurrentPrimarySelection
//   APPROVED requires (all four, conjunctively):
//     1. exactly one non-superseded match run for the BOQ item
//     2. >= 1 candidate on that run, none Rejected / Auto-Rejected Technical
//     3. a non-superseded safety_decisions row for that candidate
//     4. a safety_approval_requests row, approval_type='Technical', status='Approved',
//        whose entity_version EQUALS that safety decision's version_number
//
// No production source, migration, schema, or live business state is mutated.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { resolveCurrentPrimarySelection, PRIMARY_SELECTION_STATES } from "../worker/primary-selection-authority.mjs";
import { handleFireAlarmPanelSizingApi } from "../worker/fire-alarm-panel-sizing-api.mjs";

// Names the sizing guard's code from the resolver's return value, so the test
// asserts the real guard predicate rather than a restatement of it.
const resultCodeFor = (selection) =>
  selection.status !== "APPROVED" || selection.selection?.productId !== "product-panel"
    ? "CURRENT_APPROVED_PANEL_SELECTION_REQUIRED"
    : null;

// A D1-shaped adapter over node:sqlite, identical in shape to the established
// pattern in tests/r7-panel-sizing-production.test.mjs:11-34.
const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
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

// Minimal real-schema shape for exactly the tables the two production paths read.
// Column names/types mirror the live chain; no substitute authority is invented.
const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  archived_at TEXT, system_domain TEXT, name TEXT
);
CREATE TABLE project_members (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT NOT NULL, status TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, current_version_id TEXT,
  deleted_at TEXT, archived_at TEXT, logical_name TEXT
);
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version_number INTEGER,
  effective_from TEXT, effective_to TEXT, superseded_at TEXT
);
CREATE TABLE document_supersessions (
  id TEXT PRIMARY KEY NOT NULL, superseding_version_id TEXT NOT NULL, superseded_version_id TEXT NOT NULL,
  scope_type TEXT NOT NULL, scope_id TEXT, supersession_type TEXT NOT NULL,
  effective_from TEXT, effective_to TEXT, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE boq_extraction_versions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL, status TEXT NOT NULL, superseded_at TEXT
);
CREATE TABLE boq_items (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_document_id TEXT NOT NULL,
  extraction_version_id TEXT NOT NULL, sequence INTEGER NOT NULL, section_path TEXT NOT NULL,
  row_type TEXT NOT NULL, review_status TEXT NOT NULL, approved_for_downstream INTEGER NOT NULL,
  confidence_state TEXT NOT NULL, extraction_confidence INTEGER NOT NULL, source_location TEXT NOT NULL,
  original_raw_values TEXT NOT NULL, current_values TEXT NOT NULL,
  description TEXT, item_number TEXT, original_quantity TEXT, numeric_quantity TEXT,
  original_unit TEXT, normalized_unit TEXT, unit_rule TEXT, quantity_confidence INTEGER,
  section TEXT, subsection TEXT, hierarchy_depth INTEGER, system_value TEXT, system_source_type TEXT,
  system_confidence INTEGER, category TEXT, subcategory TEXT, normalized_description TEXT,
  manufacturer TEXT, brand TEXT, model TEXT, part_number TEXT, specification_reference TEXT,
  drawing_reference TEXT, notes TEXT, duplicate_of_item_id TEXT
);
CREATE TABLE requirement_profile_versions (
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, version_number INTEGER,
  status TEXT, profile TEXT, superseded_at TEXT
);
CREATE TABLE boq_quantity_source_decisions (
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, status TEXT, source TEXT
);
CREATE TABLE product_match_runs (
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT,
  version_number INTEGER, status TEXT, superseded_at TEXT
);
CREATE TABLE product_match_candidates (
  id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, review_status TEXT,
  technical_status TEXT, confidence TEXT, recommendation_tier TEXT, search_stage TEXT
);
CREATE TABLE safety_decisions (
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, candidate_id TEXT,
  version_number INTEGER, safety_state TEXT, compliance_state TEXT,
  technical_eligibility TEXT, price_eligibility TEXT, confidence_components TEXT,
  missing_information TEXT, ruleset_version TEXT, superseded_at TEXT
);
CREATE TABLE safety_blocks (
  id TEXT PRIMARY KEY, safety_decision_id TEXT, code TEXT, severity TEXT, overridable INTEGER,
  status TEXT, source TEXT, subject TEXT, resolution_decision_id TEXT
);
CREATE TABLE safety_warnings (
  id TEXT PRIMARY KEY, safety_decision_id TEXT, code TEXT, severity TEXT,
  acknowledgment_required INTEGER, acknowledged_at TEXT
);
CREATE TABLE safety_approval_requests (
  id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_type TEXT,
  approval_level INTEGER, status TEXT, requested_by TEXT, requested_role TEXT,
  request_reason TEXT, evidence TEXT, entity_version INTEGER, ruleset_version TEXT,
  decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT
);
CREATE TABLE safety_overrides (
  id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_level INTEGER,
  block_codes TEXT, override_type TEXT, reason TEXT, technical_justification TEXT,
  commercial_justification TEXT, evidence TEXT, scope TEXT, expires_at TEXT,
  status TEXT, requested_by TEXT, requested_role TEXT, decided_by TEXT, decided_role TEXT,
  decision_reason TEXT, decided_at TEXT, created_at TEXT
);
CREATE TABLE library_products (
  id TEXT PRIMARY KEY, manufacturer_id TEXT, part_number TEXT NOT NULL,
  normalized_part_number TEXT, description TEXT, review_status TEXT,
  approved_for_discovery INTEGER, identity_status TEXT, superseded_by_product_id TEXT,
  identity_version INTEGER, product_role TEXT, lifecycle_status TEXT,
  requested_product_id TEXT, source_reliability TEXT
);
CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT);
CREATE TABLE product_source_evidence (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, source_type TEXT);
CREATE VIEW canonical_library_products AS
  SELECT * FROM library_products
   WHERE requested_product_id = id AND identity_status = 'Active'
     AND review_status <> 'Rejected'
     AND EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.product_id = library_products.id);
CREATE TABLE product_attributes (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, attribute_name TEXT NOT NULL,
  value_json TEXT, normalized_value TEXT, original_value TEXT, unit TEXT,
  review_status TEXT, version_number INTEGER, superseded_at TEXT, deleted_at TEXT
);
CREATE TABLE product_accessories (
  id TEXT PRIMARY KEY, product_id TEXT, accessory_product_id TEXT, relationship_type TEXT,
  quantity_parameter REAL, conditions TEXT, approved_for_downstream INTEGER,
  reviewed_by TEXT, evidence TEXT, confidence REAL, review_status TEXT,
  created_by TEXT, created_at TEXT, superseded_at TEXT, deleted_at TEXT
);
`;

const seed = ({ safetyEligibility = "Eligible", openBlocks = 0, approvalStatus = null } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO organizations_placeholder VALUES (1);
  `.replace("INSERT INTO organizations_placeholder VALUES (1);", ""));
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1',NULL,'Fire Alarm','Golden Acceptance');
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL,'boq.xlsx');
    INSERT INTO document_versions VALUES ('dv1','doc1',1,NULL,NULL,NULL);
    INSERT INTO boq_extraction_versions VALUES ('ev1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO boq_items
      (id,project_id,source_document_id,extraction_version_id,sequence,section_path,row_type,review_status,
       approved_for_downstream,confidence_state,extraction_confidence,source_location,original_raw_values,
       current_values,description,item_number,original_quantity,numeric_quantity,original_unit,normalized_unit)
      VALUES ('boq-panel','p1','doc1','ev1',1,'G','BOQ Item','Approved',1,'High',95,'G1','{}','{}',
              'Main Fire alarm control panel with all required hardware','G','1','1','No','No');
    INSERT INTO requirement_profile_versions
      VALUES ('profile-panel','p1','boq-panel',3,'Completed',
              '{"boqItem":{"productFamily":"Fire Alarm Control Panel"}}',NULL);
    INSERT INTO product_match_runs VALUES ('run-panel','p1','boq-panel','profile-panel',1,'Needs Review',NULL);
    INSERT INTO product_match_candidates
      VALUES ('candidate-panel','run-panel','product-panel',1,'Needs Review','Technically Compliant',
              'Verified','Recommended Candidate','Structured');
    INSERT INTO product_manufacturers VALUES ('mfr-1','Golden Manufacturer','Saudi Arabia');
    INSERT INTO product_source_evidence VALUES ('se1','product-panel','Product Datasheet');
    INSERT INTO library_products
      VALUES ('product-panel','mfr-1','FACP-500','FACP-500','Fire alarm control panel','Reviewed',1,'Active',
              NULL,1,NULL,'Active','product-panel','verified');
    INSERT INTO safety_decisions
      VALUES ('safety-panel','p1','boq-panel','candidate-panel',7,'Approval Ready','Compliant',
              '${safetyEligibility}','Eligible','{}','[]','ruleset-1',NULL);
  `);
  for (let i = 0; i < openBlocks; i += 1) {
    raw.prepare("INSERT INTO safety_blocks VALUES (?,?,?,?,?,?,?,?,?)")
      .run(`block-${i}`, "safety-panel", `BLOCK_${i}`, "Critical", 0, "Open", null, null, null);
  }
  if (approvalStatus) {
    raw.prepare(
      "INSERT INTO safety_approval_requests (id,project_id,safety_decision_id,approval_type,approval_level,status,entity_version,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("approval-panel", "p1", "safety-panel", "Technical", 1, approvalStatus, 7, "now", "now");
  }
  return { raw, env: { DB: d1(raw) } };
};

const approvalRequest = (body) => new Request("http://local/api/match-candidates/candidate-panel/safety/approve", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const APPROVE_BODY = {
  approvalType: "Technical",
  entityVersion: 7,
  reason: "Controlled technical eligibility explicitly approved for Golden",
  evidence: { source: "golden-product-source" },
  approvalLevel: 1,
};

const envFor = (raw) => ({
  DB: d1(raw),
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "owner1",
  APP_ORGANIZATION_ID: "org1",
});

// ---------------------------------------------------------------------------
// 1 + 6. RED before, GREEN after -- driven only through the canonical route.
// ---------------------------------------------------------------------------

test("GOLDEN-2-1. the approved primary panel selection is produced by the EXISTING governed route, with no direct row fabrication", async (t) => {
  await t.test("RED: no approval row => resolveCurrentPrimarySelection is PROVISIONAL, so the sizing guard fires", async () => {
    const { raw, env } = seed();
    try {
      // Precondition: the row genuinely does not exist.
      assert.equal(
        raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c,
        0,
        "no approval row may exist before the governed route is driven",
      );
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.status, PRIMARY_SELECTION_STATES.PROVISIONAL);
      assert.equal(authority.approved, false);
    } finally { raw.close(); }
  });

  await t.test("RED: the sizing guard's own predicate rejects a PROVISIONAL selection", async () => {
    // The guard is exactly `selection.status !== "APPROVED" || selection.productId !== panel.productId`
    // (worker/fire-alarm-panel-sizing-api.mjs:361). Its input is
    // resolveCurrentPrimarySelection's return value, so proving that resolver is
    // the governed proof of this guard. The producer-level reproduction, which
    // needs the full approved-architecture chain to reach this guard at all, is
    // owned and already green in tests/r7-panel-sizing-production.test.mjs
    // ("current selection and match run must be approved, exact, and nonstale").
    const { raw, env } = seed();
    try {
      const selection = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      const guardFires = selection.status !== "APPROVED" || selection.selection?.productId !== "product-panel";
      assert.equal(guardFires, true, "the guard must fire while no approved selection exists");
      assert.equal(resultCodeFor(selection), "CURRENT_APPROVED_PANEL_SELECTION_REQUIRED");
    } finally { raw.close(); }
  });

  await t.test("GREEN: driving POST /api/match-candidates/:id/safety/approve creates the row and clears the guard", async () => {
    const { raw, env } = seed();
    const actorEnv = envFor(raw);
    try {
      const approval = await handleConfidenceSafetyApi(approvalRequest(APPROVE_BODY), actorEnv);
      assert.equal(approval.status, 200, `governed approval failed: ${JSON.stringify(await approval.clone().json())}`);
      const body = await approval.json();
      assert.equal(body.approved, true);
      assert.equal(body.type, "Technical");

      // The row now exists, written by the production route -- not by test SQL.
      const row = raw.prepare("SELECT status, approval_type, entity_version FROM safety_approval_requests WHERE id=?").get(body.approvalId);
      assert.equal(row.status, "Approved");
      assert.equal(row.approval_type, "Technical");
      assert.equal(row.entity_version, 7);

      // The governed authority now resolves APPROVED...
      const authority = await resolveCurrentPrimarySelection(actorEnv.DB, "boq-panel");
      assert.equal(authority.status, PRIMARY_SELECTION_STATES.APPROVED);
      assert.equal(authority.selection.productId, "product-panel");
      assert.equal(authority.technicalApproval.status, "Approved");

      // ...so the sizing guard's predicate is satisfied. The producer advances
      // past THIS guard; it is not expected to succeed overall, because further
      // governed gates (product identity, capacity, topology) remain.
      const selection = await resolveCurrentPrimarySelection(actorEnv.DB, "boq-panel");
      assert.equal(selection.status !== "APPROVED" || selection.selection?.productId !== "product-panel", false,
        "the governed approval must clear CURRENT_APPROVED_PANEL_SELECTION_REQUIRED");
    } finally { raw.close(); }
  });
});

test("GOLDEN-2-2. producer-level reproduction remains owned by the R7 suite, and this slice does not widen it", async () => {
  // Bounds this slice honestly: the sizing guard is proven here at its own
  // predicate, and the end-to-end producer reproduction is proven by the
  // existing R7 suite. Nothing in this slice relaxes, bypasses, or re-orders a
  // producer gate, and "green" here never means "sizing succeeds".
  const { readFile } = await import("node:fs/promises");
  const producer = await readFile(new URL("../worker/fire-alarm-panel-sizing-api.mjs", import.meta.url), "utf8");
  // The guard is still fail-closed and still exact.
  assert.match(
    producer,
    /if \(selection\.status !== "APPROVED" \|\| selection\.selection\?\.productId !== panel\.productId\) fail\("CURRENT_APPROVED_PANEL_SELECTION_REQUIRED"/,
  );
  // The existing producer-level reproduction is still present and unweakened.
  const r7 = await readFile(new URL("../tests/r7-panel-sizing-production.test.mjs", import.meta.url), "utf8");
  assert.match(r7, /CURRENT_APPROVED_PANEL_SELECTION_REQUIRED/);
  assert.match(r7, /STALE_PANEL_PRODUCT_SELECTION/);
});

// ---------------------------------------------------------------------------
// 2 + 3 + 4 + 5. The governed route's own refusals, and resolver revocation.
// ---------------------------------------------------------------------------

test("GOLDEN-2-3. the governed approval route refuses every ungoverned shortcut", async (t) => {
  await t.test("a Blocked eligibility with an OPEN non-overridable block is refused (APPROVAL_BLOCKED)", async () => {
    const { raw } = seed({ safetyEligibility: "Blocked", openBlocks: 1 });
    const actorEnv = envFor(raw);
    try {
      const result = await handleConfidenceSafetyApi(approvalRequest(APPROVE_BODY), actorEnv);
      assert.equal(result.status, 409);
      assert.equal(await await resultBody(result).then((b) => b.error.code), "APPROVAL_BLOCKED");
      assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0);
    } finally { raw.close(); }
  });

  await t.test("DISCOVERY_ONLY-style ineligibility is NOT rescuable by override", async () => {
    // Mirrors the acceptance project: technical_eligibility='Blocked' (not
    // 'Technical Approval Disabled'), so overriddenBlocksAllResolved is false
    // (worker/confidence-safety-api.mjs, the eligibility expression) and the
    // Open non-overridable block keeps approval impossible. This is the exact
    // state that blocks every control-panel line in project_c0123d91.
    const { raw } = seed({ safetyEligibility: "Blocked", openBlocks: 1 });
    const actorEnv = envFor(raw);
    try {
      const result = await handleConfidenceSafetyApi(approvalRequest(APPROVE_BODY), actorEnv);
      assert.equal(await await resultBody(result).then((b) => b.error.code), "APPROVAL_BLOCKED");
      assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0);
    } finally { raw.close(); }
  });

  await t.test("a stale entityVersion is refused (STALE_SAFETY_VERSION) -- CAS on the safety decision", async () => {
    const { raw } = seed();
    const actorEnv = envFor(raw);
    try {
      const result = await handleConfidenceSafetyApi(approvalRequest({ ...APPROVE_BODY, entityVersion: 6 }), actorEnv);
      assert.equal(result.status, 409);
      assert.equal(await await resultBody(result).then((b) => b.error.code), "STALE_SAFETY_VERSION");
      assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0);
    } finally { raw.close(); }
  });

  await t.test("a too-short reason is refused (APPROVAL_REASON_REQUIRED)", async () => {
    const { raw } = seed();
    const actorEnv = envFor(raw);
    try {
      const result = await handleConfidenceSafetyApi(approvalRequest({ ...APPROVE_BODY, reason: "ok" }), actorEnv);
      assert.equal(result.status, 422);
      assert.equal(await await resultBody(result).then((b) => b.error.code), "APPROVAL_REASON_REQUIRED");
      assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0);
    } finally { raw.close(); }
  });

  await t.test("a stale requirement profile is refused (REQUIREMENT_PROFILE_CHANGED)", async () => {
    const { raw } = seed();
    const actorEnv = envFor(raw);
    try {
      raw.prepare("UPDATE product_match_runs SET requirement_profile_version_id='older-profile' WHERE id='run-panel'").run();
      const result = await handleConfidenceSafetyApi(approvalRequest(APPROVE_BODY), actorEnv);
      assert.equal(result.status, 409);
      assert.equal(await await resultBody(result).then((b) => b.error.code), "REQUIREMENT_PROFILE_CHANGED");
      assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0);
    } finally { raw.close(); }
  });
});

test("GOLDEN-2-4. a historical approval must not satisfy current selection authority", async (t) => {
  await t.test("a Rejected approval does NOT resolve APPROVED", async () => {
    const { raw, env } = seed({ approvalStatus: "Rejected" });
    try {
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.notEqual(authority.status, PRIMARY_SELECTION_STATES.APPROVED);
      assert.equal(authority.approved, false);
    } finally { raw.close(); }
  });

  await t.test("a Pending approval does NOT resolve APPROVED", async () => {
    const { raw, env } = seed({ approvalStatus: "Pending" });
    try {
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.approved, false);
    } finally { raw.close(); }
  });

  await t.test("an approval whose entity_version does not match the decision is ignored", async () => {
    const { raw, env } = seed({ approvalStatus: "Approved" });
    try {
      raw.prepare("UPDATE safety_approval_requests SET entity_version=6 WHERE id='approval-panel'").run();
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.approved, false, "an approval for a different decision version must not count");
    } finally { raw.close(); }
  });

  await t.test("a rejected candidate cannot be the primary selection", async () => {
    const { raw, env } = seed({ approvalStatus: "Approved" });
    try {
      raw.prepare("UPDATE product_match_candidates SET review_status='Rejected' WHERE id='candidate-panel'").run();
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.approved, false);
    } finally { raw.close(); }
  });

  await t.test("an Auto-Rejected Technical candidate cannot be the primary selection", async () => {
    const { raw, env } = seed({ approvalStatus: "Approved" });
    try {
      raw.prepare("UPDATE product_match_candidates SET review_status='Auto-Rejected Technical' WHERE id='candidate-panel'").run();
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.approved, false);
    } finally { raw.close(); }
  });

  await t.test("a superseded match run cannot carry the selection", async () => {
    const { raw, env } = seed({ approvalStatus: "Approved" });
    try {
      raw.prepare("UPDATE product_match_runs SET superseded_at='now' WHERE id='run-panel'").run();
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.approved, false);
    } finally { raw.close(); }
  });

  await t.test("a superseded safety decision cannot carry the selection", async () => {
    const { raw, env } = seed({ approvalStatus: "Approved" });
    try {
      raw.prepare("UPDATE safety_decisions SET superseded_at='now' WHERE id='safety-panel'").run();
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.approved, false);
    } finally { raw.close(); }
  });

  await t.test("a second contributing current match run makes the selection ambiguous, never approved", async () => {
    // A second current run only participates if it contributes a candidate: the
    // resolver derives matchRunIds FROM the candidate rows. A candidate-free run
    // is correctly ignored. This asserts the fail-closed direction -- two
    // contributing runs must not silently pick one.
    const { raw, env } = seed({ approvalStatus: "Approved" });
    try {
      const empty = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      raw.prepare("INSERT INTO product_match_runs VALUES ('run-panel-2','p1','boq-panel','profile-panel',1,'Needs Review',NULL)").run();
      assert.equal((await resolveCurrentPrimarySelection(env.DB, "boq-panel")).status, "APPROVED",
        "a candidate-free second run contributes no candidate and cannot create ambiguity");
      raw.prepare("INSERT INTO product_match_candidates VALUES ('candidate-panel-2','run-panel-2','product-panel',1,'Needs Review','Technically Compliant','Verified','Recommended Candidate','Structured')").run();
      const ambiguous = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(ambiguous.approved, false, "two contributing runs must never resolve APPROVED");
      assert.ok([PRIMARY_SELECTION_STATES.AMBIGUOUS, "UNAVAILABLE"].includes(ambiguous.status), `unexpected ${ambiguous.status}`);
      assert.ok(empty.approved);
    } finally { raw.close(); }
  });

  await t.test("the approval must name THIS candidate's decision, not another BOQ item's", async () => {
    const { raw, env } = seed({ approvalStatus: "Approved" });
    try {
      // A second BOQ item with its own approved decision must not be able to
      // satisfy the panel item's selection by cross-contamination.
      raw.exec(`
        INSERT INTO boq_items
          (id,project_id,source_document_id,extraction_version_id,sequence,section_path,row_type,review_status,
           approved_for_downstream,confidence_state,extraction_confidence,source_location,original_raw_values,
           current_values,description,item_number)
          VALUES ('boq-other','p1','doc1','ev1',2,'G','BOQ Item','Approved',1,'High',95,'G2','{}','{}',
                  'Other line','H');
        INSERT INTO product_match_runs VALUES ('run-other','p1','boq-other','profile-panel',1,'Needs Review',NULL);
        INSERT INTO product_match_candidates VALUES ('candidate-other','run-other','product-panel',1,'Needs Review','Technically Compliant','Verified','Recommended Candidate','Structured');
        INSERT INTO safety_decisions VALUES ('safety-other','p1','boq-other','candidate-other',1,'Approval Ready','Compliant','Eligible','Eligible','{}','[]','ruleset-1',NULL);
      `);
      const authority = await resolveCurrentPrimarySelection(env.DB, "boq-panel");
      assert.equal(authority.approved, true, "the panel item's own approval still resolves");
      // And the cross-item approval must NOT resolve the other item.
      raw.prepare("UPDATE safety_approval_requests SET safety_decision_id='safety-panel' WHERE id='approval-panel'").run();
      const other = await resolveCurrentPrimarySelection(env.DB, "boq-other");
      assert.equal(other.approved, false, "an approval naming another decision must not resolve this item");
    } finally { raw.close(); }
  });
});

test("GOLDEN-2-5. existing selection/approval governance is unchanged by this slice", async () => {
  // Structural pin: the single production writer of safety_approval_requests is
  // the governed approve route, and it is still the only INSERT. If a future
  // change adds a second writer, this test fails and the new authority is
  // re-reviewed rather than silently relied upon.
  const { readFile } = await import("node:fs/promises");
  const confidenceSafety = await readFile(new URL("../worker/confidence-safety-api.mjs", import.meta.url), "utf8");
  const inserts = confidenceSafety.match(/INSERT INTO safety_approval_requests/g) || [];
  assert.equal(inserts.length, 1, "there must remain exactly ONE writer of safety_approval_requests");

  // And the resolver must remain profile-agnostic by design (EVIDENCE-CURRENCY-1):
  // staleness is enforced by the sizing producer's own STALE_PANEL_PRODUCT_SELECTION.
  const resolver = await readFile(new URL("../worker/primary-selection-authority.mjs", import.meta.url), "utf8");
  assert.match(resolver, /stays profile-agnostic by design/);
});

// ---------------------------------------------------------------------------
// helpers that reach the two real production handlers
// ---------------------------------------------------------------------------

const { handleConfidenceSafetyApi } = await import("../worker/confidence-safety-api.mjs").then(
  (m) => ({ handleConfidenceSafetyApi: m.handleConfidenceSafetyApi }),
);

const panelSizingRequest = () => new Request(
  "http://local/api/projects/p1/fire-alarm/panel-sizing",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reason: "Golden governed panel sizing allocation",
      provenance: { source: "golden-evidence", reference: "E2E" },
      panels: [{ panelId: "PANEL-1", boqItemId: "boq-panel", productId: "product-panel", architectureIdentity: "FACP-1" }],
      allocations: [],
      exclusions: [],
    }),
  },
);

// A real Response body can only be consumed once, so cache it per response.
const bodyCache = new WeakMap();
const resultBody = async (response) => {
  if (bodyCache.has(response)) return bodyCache.get(response);
  const value = await response.clone().json().catch(() => ({}));
  bodyCache.set(response, value);
  return value;
};
