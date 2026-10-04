import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  MACHINE_GENERATED_LINK_STATUSES,
  planRequirementLinkSupersession,
} from "../app/domain/engineering-knowledge.mjs";
import { handleEngineeringKnowledgeApi } from "../worker/engineering-knowledge-api.mjs";

// Requirement-applicability generation currency.
//
// THE DEFECT. `suggestLinks` used to retire every machine-generated
// applicability link for a project unconditionally, first, before -- and
// independently of -- the generation meant to replace it. A run whose eligible
// requirement set was empty therefore retired the whole machine-generated set,
// created nothing, and still reported SUCCESS (`created: 0, superseded: 100`).
// Every affected item afterwards read as a legitimate "no applicable
// requirements" state with no successor and no recovery path.
//
// These tests drive the real HTTP handler over the real migration-backed
// schema. They are behavioural: every assertion reads persisted rows back out
// of the database, never the source text.

const buildFullDb = () => {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../drizzle-active/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  return raw;
};

const d1Shim = (raw, { failOn = null } = {}) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    const bound = { ...operation(), sql };
    return { ...bound, bind: (...values) => ({ ...operation(values), sql }) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        const { sql } = statement;
        if (failOn && sql.includes(failOn)) throw new Error(`injected failure: ${failOn}`);
        results.push(await statement.run());
      }
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const env = (d1) => ({
  DB: d1,
  APP_USER_ID: "user-currency",
  APP_ORGANIZATION_ID: "org-currency",
  APP_USER_EMAIL: "user-currency@local.invalid",
  APP_USER_NAME: "Currency User",
});

const run = async (d1, projectId = "p-currency") =>
  handleEngineeringKnowledgeApi(
    new Request(`http://localhost/api/projects/${projectId}/engineering-knowledge/suggest-links`, { method: "POST" }),
    env(d1),
  );

// One BOQ item ("Smoke Detector") plus a current, approved, downstream-eligible
// requirement that scores against it. `requirements` may be set to [] to model
// the "eligible requirement set went empty" condition.
const seed = (raw, { projectId = "p-currency", items = 1, requirements = 1, links = [], eligibleRequirements = true } = {}) => {
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org-currency','Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain)
      VALUES ('${projectId}','Currency Project','user-currency','org-currency','Fire Alarm');
    INSERT INTO documents (id, project_id, logical_name, current_version_id, created_by)
      VALUES ('doc-currency','${projectId}','spec.pdf','dv-currency','user-currency');
    INSERT INTO document_versions
      (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv-currency','doc-currency',1,'spec.pdf','spec.pdf','pdf','application/pdf',1,'sha-currency','key-currency','user-currency');
    INSERT INTO boq_extraction_versions
      (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('boqext-currency','doc-currency','dv-currency',1,'Completed','1','1','1','user-currency');
    INSERT INTO specification_extraction_versions
      (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version,
       model_version, prompt_version, ocr_version, created_by)
      VALUES ('specext-currency','doc-currency','dv-currency',1,'Completed','1','1','1','1','1','user-currency');
  `);
  for (let i = 1; i <= items; i += 1) {
    raw.exec(`
      INSERT INTO boq_items
        (id, extraction_version_id, project_id, source_document_id, sequence, row_type, description,
         extraction_confidence, confidence_state, review_status, source_location, original_raw_values,
         current_values, approved_for_downstream, system_value, category, normalized_unit,
         numeric_quantity, section_path)
        VALUES ('boq-${i}','boqext-currency','${projectId}','doc-currency',${i},'BOQ Item','Smoke Detector Ceiling Mounted',
         95,'High','Approved','{}','[]','{}',1,'Fire Alarm','Detection Devices','Each','10','[]');
    `);
  }
  for (let i = 1; i <= requirements; i += 1) {
    raw.exec(`
      INSERT INTO technical_requirements
        (id, extraction_version_id, project_id, source_document_id, sequence, original_text,
         normalized_requirement, engineering_domain, domain_source_type, system, category,
         requirement_type, requirement_category, confidence, confidence_state, review_status,
         extraction_method, parser_version, model_version, source_location, original_values,
         current_values, approved_for_downstream)
        VALUES ('req-currency-${i}','specext-currency','${projectId}','doc-currency',${i},
         'Smoke detectors shall comply with UL 268 standard for smoke detectors.',
         'smoke detectors shall comply with ul 268 standard for smoke detectors',
         'Fire Alarm','Inferred','Fire Alarm','Detection Devices',
         'Mandatory','Standards',95,'High','Approved',
         'pdfjs','1','1','{}','{}','{}',${eligibleRequirements ? 1 : 0});
    `);
  }
  for (const link of links) {
    raw.exec(`
      INSERT INTO boq_requirement_links
        (id, project_id, boq_item_id, requirement_id, link_method, confidence, evidence, status,
         scope_id, version_number, previous_version_id, reviewed_by, reviewed_at, review_reason, created_by, created_at, superseded_at)
        VALUES ('${link.id}','${projectId}','${link.item}','${link.requirement}','${link.method || "Technical Applicability v2 · bounded shortlist"}',
         ${link.confidence ?? 60},'[]','${link.status}','${link.item}',${link.version ?? 1},${link.previous ? `'${link.previous}'` : "NULL"},
         ${link.reviewedBy ? `'${link.reviewedBy}'` : "NULL"},${link.reviewedAt ? `'${link.reviewedAt}'` : "NULL"},
         ${link.reviewReason ? `'${link.reviewReason}'` : "NULL"},'user-currency','2026-01-01T00:00:00.000Z',${link.supersededAt ? `'${link.supersededAt}'` : "NULL"});
    `);
  }
};

const currentLinks = (raw, projectId = "p-currency") =>
  raw.prepare("SELECT id, boq_item_id, requirement_id, status, version_number, previous_version_id FROM boq_requirement_links WHERE project_id=? AND superseded_at IS NULL ORDER BY id").all(projectId);

const audit = (raw, projectId = "p-currency") =>
  raw.prepare("SELECT action, new_value FROM document_audit_events WHERE project_id=? ORDER BY created_at").all(projectId);

// ---------------------------------------------------------------------------
// Pure decision tests -- the planner is the single authority for what one
// generation may retire.
// ---------------------------------------------------------------------------

test("planner: a run with no eligible requirement retires nothing and returns a governed refusal", () => {
  const plan = planRequirementLinkSupersession({
    activeLinks: [
      { id: "l1", boq_item_id: "b1", requirement_id: "r1", status: "Suggested" },
      { id: "l2", boq_item_id: "b2", requirement_id: "r2", status: "Needs Review" },
    ],
    processedItemIds: ["b1", "b2"],
    proposedPairs: [],
    eligibleRequirementCount: 0,
  });
  assert.deepEqual(plan.retire, [], "nothing may be retired");
  assert.equal(plan.refused.code, "APPLICABILITY_GENERATION_EMPTY");
  assert.deepEqual(plan.retainedOutOfScope.sort(), ["l1", "l2"]);
  assert.equal(plan.refused.machineLinksRetained, 2);
});

test("planner: a run that would orphan an item is refused, never a wholesale wipe", () => {
  const plan = planRequirementLinkSupersession({
    activeLinks: [{ id: "l1", boq_item_id: "b1", requirement_id: "r1", status: "Suggested" }],
    processedItemIds: ["b1"],
    proposedPairs: [],
    eligibleRequirementCount: 7, // requirements exist, but nothing scored
  });
  assert.deepEqual(plan.retire, []);
  assert.equal(plan.refused.code, "APPLICABILITY_GENERATION_NO_SUCCESSOR");
});

test("planner: human-governed statuses are never retirable, even when superseded-stale", () => {
  const governed = ["Confirmed", "Rejected", "Removed"];
  for (const status of governed) {
    const plan = planRequirementLinkSupersession({
      activeLinks: [{ id: `g-${status}`, boq_item_id: "b1", requirement_id: "r1", status }],
      processedItemIds: ["b1"],
      proposedPairs: [{ boqItemId: "b1", requirementId: "r1" }],
      eligibleRequirementCount: 1,
    });
    assert.deepEqual(plan.retire, [], `${status} must never be retired by a machine generation`);
    assert.deepEqual(plan.governedUntouched, [`g-${status}`]);
  }
  assert.deepEqual([...MACHINE_GENERATED_LINK_STATUSES], ["Suggested", "Needs Review"]);
});

test("planner: a link on an item this run never evaluated is retained, not retired", () => {
  const plan = planRequirementLinkSupersession({
    activeLinks: [
      { id: "in-scope", boq_item_id: "b1", requirement_id: "r1", status: "Suggested" },
      { id: "out-of-scope", boq_item_id: "b9", requirement_id: "r1", status: "Suggested" },
    ],
    processedItemIds: ["b1"],
    proposedPairs: [{ boqItemId: "b1", requirementId: "r1" }],
    eligibleRequirementCount: 1,
  });
  assert.deepEqual(plan.retire, ["in-scope"]);
  assert.deepEqual(plan.retainedOutOfScope, ["out-of-scope"]);
  assert.equal(plan.refused, null);
});

test("planner: an evaluated item with no applicable candidate is an explicit retraction, not a silent disappearance", () => {
  // b2 holds a redundant machine link beside a governed one. The machine link is
  // a genuine finding -- this run evaluated b2 and proposed nothing for it --
  // so it is retired and REPORTED, and b2 is not orphaned because its Confirmed
  // link is never retirable.
  const plan = planRequirementLinkSupersession({
    activeLinks: [
      { id: "replaced", boq_item_id: "b1", requirement_id: "r1", status: "Suggested" },
      { id: "retracted", boq_item_id: "b2", requirement_id: "r9", status: "Suggested" },
      { id: "b2-governed", boq_item_id: "b2", requirement_id: "r2", status: "Confirmed" },
    ],
    processedItemIds: ["b1", "b2"],
    proposedPairs: [{ boqItemId: "b1", requirementId: "r1" }],
    eligibleRequirementCount: 1,
  });
  assert.equal(plan.refused, null);
  assert.deepEqual(plan.replaced, ["replaced"]);
  assert.deepEqual(plan.retracted, ["retracted"], "an explicit, reported retraction");
  assert.deepEqual(plan.retire.sort(), ["replaced", "retracted"]);
  assert.deepEqual(plan.governedUntouched, ["b2-governed"]);
});

test("planner: retracting an item's only link is refused -- the item would be orphaned", () => {
  const plan = planRequirementLinkSupersession({
    activeLinks: [
      { id: "replaced", boq_item_id: "b1", requirement_id: "r1", status: "Suggested" },
      { id: "only-link", boq_item_id: "b2", requirement_id: "r2", status: "Suggested" },
    ],
    processedItemIds: ["b1", "b2"],
    proposedPairs: [{ boqItemId: "b1", requirementId: "r1" }],
    eligibleRequirementCount: 1,
  });
  assert.equal(plan.refused.code, "APPLICABILITY_GENERATION_NO_SUCCESSOR");
  assert.deepEqual(plan.orphanedItemIds, ["b2"]);
  assert.deepEqual(plan.retire, [], "a partial retirement is not performed either");
});

// ---------------------------------------------------------------------------
// Production-path tests -- real handler, real migration-backed schema.
// ---------------------------------------------------------------------------

test("T1 normal regeneration: the previous generation is retired only because a successor exists", async () => {
  const raw = buildFullDb();
  seed(raw, {
    requirements: 1,
    links: [{ id: "old-1", item: "boq-1", requirement: "req-currency-1", status: "Suggested" }],
  });
  const d1 = d1Shim(raw);

  const response = await run(d1);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.suggestions.linksConsidered, 1);
  assert.equal(body.suggestions.superseded, 1);
  assert.equal(body.suggestions.replaced, 1);
  assert.equal(body.suggestions.retracted, 0);

  const current = currentLinks(raw);
  assert.equal(current.length, 1);
  assert.notEqual(current[0].id, "old-1", "the successor is a new row");
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE id='old-1' AND superseded_at IS NOT NULL").get().c,
    1,
    "the prior generation is retired once the successor is established",
  );
  assert.match(audit(raw)[0].new_value, /"replaced":1/);
});

test("T2 empty regeneration: no eligible requirement must not wipe the current set (the reproduced defect)", async () => {
  const raw = buildFullDb();
  seed(raw, {
    requirements: 1,
    eligibleRequirements: false, // the eligible requirement set went empty
    links: [
      { id: "keep-1", item: "boq-1", requirement: "req-currency-1", status: "Suggested" },
      { id: "keep-2", item: "boq-1", requirement: "req-currency-1", status: "Needs Review", version: 2 },
    ],
  });
  const d1 = d1Shim(raw);

  const response = await run(d1);
  assert.equal(response.status, 409, "refused, not reported as a successful empty run");
  const body = await response.json();
  assert.equal(body.error.code, "APPLICABILITY_GENERATION_EMPTY");
  assert.equal(body.error.machineLinksRetained, 2);

  const current = currentLinks(raw);
  assert.equal(current.length, 2, "both links survive the refused run");
  assert.deepEqual(current.map((l) => l.id).sort(), ["keep-1", "keep-2"]);
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE superseded_at IS NOT NULL").get().c,
    0,
    "nothing was retired",
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement Applicability Suggestions Generated'").get().c,
    0,
    "no success audit is written for a refused run",
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement Applicability Generation Refused'").get().c,
    1,
    "the refusal is recorded",
  );
});

test("T3 failure during regeneration: the old current generation survives", async () => {
  const raw = buildFullDb();
  seed(raw, {
    requirements: 1,
    links: [{ id: "survivor", item: "boq-1", requirement: "req-currency-1", status: "Suggested" }],
  });
  // Inserts are emitted before retirements, so a failing insert aborts the run
  // before any retirement statement is ever reached.
  const d1 = d1Shim(raw, { failOn: "INSERT INTO boq_requirement_links" });

  await assert.rejects(() => run(d1), /injected failure/);

  const current = currentLinks(raw);
  assert.equal(current.length, 1, "the prior generation is still current");
  assert.equal(current[0].id, "survivor");
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE superseded_at IS NOT NULL").get().c,
    0,
    "a failed run destroys nothing",
  );
});

test("T4 human-confirmed applicability survives an ordinary machine regeneration", async () => {
  const raw = buildFullDb();
  seed(raw, {
    requirements: 1,
    links: [
      {
        id: "engineer-confirmed",
        item: "boq-1",
        requirement: "req-currency-1",
        status: "Confirmed",
        method: "Engineer Review - device-specific clause",
        confidence: 92,
        reviewedBy: "user-currency",
        reviewedAt: "2026-01-02T00:00:00.000Z",
        reviewReason: "Engineer confirmed this clause governs the device.",
      },
      { id: "machine-suggested", item: "boq-1", requirement: "req-currency-1", status: "Suggested", version: 2 },
    ],
  });
  const d1 = d1Shim(raw);

  const response = await run(d1);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.suggestions.governedLinksUntouched, 1);

  const confirmed = raw.prepare("SELECT * FROM boq_requirement_links WHERE id='engineer-confirmed'").get();
  assert.equal(confirmed.status, "Confirmed", "authority is not downgraded");
  assert.equal(confirmed.superseded_at, null, "authority is not retired by a machine run");
  assert.equal(confirmed.reviewed_by, "user-currency");
  assert.equal(confirmed.review_reason, "Engineer confirmed this clause governs the device.");
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE id='engineer-confirmed' AND status='Confirmed'").get().c,
    1,
    "no duplicate Confirmed link was created for the same pair",
  );
});

test("T5 version lineage: a successor points back at the prior active row and increments the version", async () => {
  const raw = buildFullDb();
  seed(raw, {
    requirements: 1,
    links: [{ id: "gen-1", item: "boq-1", requirement: "req-currency-1", status: "Suggested", version: 1 }],
  });
  const d1 = d1Shim(raw);
  assert.equal((await run(d1)).status, 201);

  const successor = raw
    .prepare("SELECT * FROM boq_requirement_links WHERE superseded_at IS NULL AND id <> 'gen-1'")
    .get();
  assert.ok(successor, "a successor exists");
  assert.equal(successor.previous_version_id, "gen-1", "lineage points at the prior active row");
  assert.equal(successor.version_number, 2, "version increments deterministically");
});

test("T6 positive control: a mixed governed/machine set regenerates without disturbing the governed rows", async () => {
  const raw = buildFullDb();
  seed(raw, {
    items: 2,
    requirements: 1,
    links: [
      { id: "p6-confirmed", item: "boq-1", requirement: "req-currency-1", status: "Confirmed", reviewedBy: "user-currency", reviewedAt: "2026-01-02T00:00:00.000Z", reviewReason: "Engineer confirmed." },
      { id: "p6-suggested", item: "boq-2", requirement: "req-currency-1", status: "Suggested" },
    ],
  });
  const d1 = d1Shim(raw);
  const response = await run(d1);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const body = await response.json();

  assert.equal(body.suggestions.governedLinksUntouched, 1);
  assert.equal(body.suggestions.superseded, 1, "only the machine link on the evaluated item is retired");
  assert.equal(body.suggestions.replaced, 1, "boq-2's machine link is re-proposed by this generation");
  assert.equal(body.suggestions.retracted, 0, "boq-1's governed pair is skipped, not treated as a machine retraction");

  const confirmed = raw.prepare("SELECT * FROM boq_requirement_links WHERE id='p6-confirmed'").get();
  assert.equal(confirmed.superseded_at, null);
  assert.equal(confirmed.status, "Confirmed");
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links WHERE superseded_at IS NOT NULL AND id='p6-suggested'").get().c,
    1,
  );
});
