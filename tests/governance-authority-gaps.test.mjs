/**
 * GOV-AUTH-1 — downstream decisions consume only evidence with required authority.
 *
 * Each test below pins a REAL gap found by the GOV-AUTH-1 audit (all claims were
 * verified against production code before implementation): a reader that
 * consumed rows without the authority its downstream decision requires. The
 * fixes reuse existing columns and predicates — no new policy, no migration,
 * no R3 duplication.
 *
 * Recorded-but-deliberately-unchanged (see the audit report): display-only
 * reads that must SHOW pending items (knowledge-profile GET, review lists),
 * ranking signals that assert nothing (family/manufacturer similarity),
 * documented policy relaxations (price validity), multi-approval pricing
 * (explicit line pick at quotation), and inert permissiveness ('Accepted' with
 * zero writers and zero live rows).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { loadPricingInput } from "../worker/pricing-runtime.mjs";
import { resolveCurrentPrimarySelection } from "../worker/primary-selection-authority.mjs";
import { loadInputs } from "../worker/technical-requirement-api.mjs";
import { handleBoqExtractionApi } from "../worker/boq-extraction-api.mjs";

// ---------------------------------------------------------------------------
// Shared minimal D1-shaped adapter (same shape as the pricing suites use).
// ---------------------------------------------------------------------------
const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
});

// ---------------------------------------------------------------------------
// M-1: a Rejected candidate cannot price, with or without a Technical approval.
// ---------------------------------------------------------------------------
const pricingFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, row_type TEXT, review_status TEXT, approved_for_downstream INTEGER, numeric_quantity REAL, normalized_unit TEXT);
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, review_status TEXT DEFAULT 'Needs Review');
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, requested_product_id TEXT, manufacturer_id TEXT, part_number TEXT, lifecycle_status TEXT);
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, candidate_id TEXT, version_number INTEGER, superseded_at TEXT, technical_eligibility TEXT, price_eligibility TEXT);
    CREATE TABLE safety_approval_requests (id TEXT PRIMARY KEY, safety_decision_id TEXT, approval_type TEXT, status TEXT, decided_at TEXT, entity_version INTEGER);
    CREATE TABLE price_records (id TEXT PRIMARY KEY, product_id TEXT, project_id TEXT, approval_status TEXT, downstream_use TEXT, currency TEXT, amount_minor INTEGER);
    CREATE TABLE boq_quantity_source_decisions (id TEXT PRIMARY KEY, boq_item_id TEXT, source TEXT, selected_quantity REAL, recognition_version_id TEXT);
    INSERT INTO projects VALUES ('p1','u1','org1',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('item1','ex1','p1','doc1','BOQ Item','Approved',1,10,'Each');
    INSERT INTO product_manufacturers VALUES ('m1','Honeywell');
    INSERT INTO canonical_library_products VALUES ('p1','p1','m1','FA-001','Active');
    INSERT INTO requirement_profile_versions VALUES ('prof1','item1',1,NULL);
    INSERT INTO product_match_runs VALUES ('run1','p1','item1','prof1',1,NULL);
    INSERT INTO product_match_candidates (id, match_run_id, product_id, review_status) VALUES ('cand-rejected','run1','p1','Rejected');
    INSERT INTO safety_decisions VALUES ('safety1','cand-rejected',1,NULL,'Eligible','Eligible');
    INSERT INTO safety_approval_requests VALUES ('appr1','safety1','Technical','Approved','2026-09-01T00:00:00Z',1);
    INSERT INTO price_records VALUES ('price1','p1','p1','Approved','Costing','SAR',1000);
  `);
  return { raw, DB: d1(raw) };
};

test("GOV-AUTH-1 pricing refuses a Rejected candidate even with a Technical approval and eligible price", async () => {
  const { raw, DB } = pricingFixture();
  try {
    await assert.rejects(
      loadPricingInput(DB, { projectId: "p1", boqItemId: "item1", candidateId: "cand-rejected" }),
      (error) => error?.code === "CANDIDATE_NOT_FOUND",
    );
  } finally {
    raw.close();
  }
});

test("GOV-AUTH-1 pricing refuses an Auto-Rejected Technical candidate", async () => {
  const { raw, DB } = pricingFixture();
  try {
    raw.prepare("UPDATE product_match_candidates SET review_status='Auto-Rejected Technical' WHERE id='cand-rejected'").run();
    await assert.rejects(
      loadPricingInput(DB, { projectId: "p1", boqItemId: "item1", candidateId: "cand-rejected" }),
      (error) => error?.code === "CANDIDATE_NOT_FOUND",
    );
  } finally {
    raw.close();
  }
});

test("GOV-AUTH-1 primary selection skips a rejected candidate even when it carries the approval", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, review_status TEXT DEFAULT 'Needs Review');
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, boq_item_id TEXT, candidate_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE safety_approval_requests (id TEXT PRIMARY KEY, safety_decision_id TEXT, approval_type TEXT, status TEXT, entity_version INTEGER, decided_at TEXT, created_at TEXT);
    INSERT INTO requirement_profile_versions VALUES ('prof1','item1',1,NULL);
    INSERT INTO product_match_runs VALUES ('run1','item1','prof1',1,NULL);
    INSERT INTO product_match_candidates (id,match_run_id,product_id,rank,review_status) VALUES
      ('cand-rejected','run1','p1',1,'Rejected'),
      ('cand-ok','run1','p2',2,'Needs Review');
    INSERT INTO safety_decisions VALUES ('s1','item1','cand-rejected',1,NULL),('s2','item1','cand-ok',1,NULL);
    INSERT INTO safety_approval_requests VALUES
      ('a1','s1','Technical','Approved',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
      ('a2','s2','Technical','Approved',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
  `);
  try {
    const result = await resolveCurrentPrimarySelection(d1(raw), "item1");
    assert.equal(result.approved, true);
    assert.equal(result.selection.candidateId, "cand-ok");
  } finally {
    raw.close();
  }
});

test("GOV-AUTH-1 primary selection resolves nothing when every candidate is rejected", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, review_status TEXT DEFAULT 'Needs Review');
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, boq_item_id TEXT, candidate_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE safety_approval_requests (id TEXT PRIMARY KEY, safety_decision_id TEXT, approval_type TEXT, status TEXT, entity_version INTEGER, decided_at TEXT, created_at TEXT);
    INSERT INTO requirement_profile_versions VALUES ('prof1','item1',1,NULL);
    INSERT INTO product_match_runs VALUES ('run1','item1','prof1',1,NULL);
    INSERT INTO product_match_candidates (id,match_run_id,product_id,rank,review_status) VALUES ('cand-rejected','run1','p1',1,'Rejected');
    INSERT INTO safety_decisions VALUES ('s1','item1','cand-rejected',1,NULL);
    INSERT INTO safety_approval_requests VALUES ('a1','s1','Technical','Approved',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
  `);
  try {
    const result = await resolveCurrentPrimarySelection(d1(raw), "item1");
    assert.equal(result.approved, false);
    assert.equal(result.selection, null);
  } finally {
    raw.close();
  }
});

// ---------------------------------------------------------------------------
// Facts channel: profile input admits reviewed facts only.
// ---------------------------------------------------------------------------
test("GOV-AUTH-1 requirement profile input excludes Pending Review and Rejected facts", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE boq_requirement_links (id TEXT PRIMARY KEY, boq_item_id TEXT, requirement_id TEXT, status TEXT, superseded_at TEXT);
    CREATE TABLE engineering_facts (id TEXT PRIMARY KEY, project_id TEXT, fact_type TEXT, status TEXT, scope_type TEXT, scope_id TEXT);
    CREATE TABLE engineering_relationships (id TEXT PRIMARY KEY, project_id TEXT, scope_type TEXT, scope_id TEXT, status TEXT, relationship_type TEXT, right_entity_type TEXT, right_entity_id TEXT);
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, identity_status TEXT, superseded_by_product_id TEXT);
    CREATE TABLE requirement_attributes (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_standards (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_manufacturers (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_compatibility (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_accessories (id TEXT PRIMARY KEY, requirement_id TEXT);
    -- MVP-CLOSE-14: review_status added to this double. The REAL
    -- technical_requirements table has always had it (see
    -- drizzle-active/0000_baseline_schema_0082.sql), and loadInputs now
    -- filters on the canonical eligibility predicate, which references it.
    -- This is a schema-COMPLETENESS correction to the double, not a change of
    -- what the test asserts: the assertion is about engineering_facts statuses
    -- and is unaffected.
    CREATE TABLE technical_requirements (id TEXT PRIMARY KEY, extraction_version_id TEXT, source_document_id TEXT, project_id TEXT, approved_for_downstream INTEGER, review_status TEXT);
    CREATE TABLE specification_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE requirement_intelligence_facts (id TEXT PRIMARY KEY, profile_version_id TEXT, requirement_id TEXT, review_status TEXT, reviewed_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT);
    CREATE TABLE engineering_fact_provenance (id TEXT PRIMARY KEY, fact_id TEXT, extraction_version_id TEXT);
    INSERT INTO engineering_facts VALUES
      ('fact-active','p1','Manufacturer Rule','Active','BOQ Item','item1'),
      ('fact-approved','p1','Human Decision','Approved','Project',NULL),
      ('fact-pending','p1','Supplier Claim','Pending Review','BOQ Item','item1'),
      ('fact-rejected','p1','Manufacturer Rule','Rejected','BOQ Item','item1'),
      ('fact-superseded','p1','Manufacturer Rule','Superseded','BOQ Item','item1');
  `);
  try {
    const { facts } = await loadInputs(d1(raw), { id: "item1", project_id: "p1" });
    assert.deepEqual(
      facts.map((row) => row.id).sort(),
      ["fact-active", "fact-approved"],
    );
  } finally {
    raw.close();
  }
});

// ---------------------------------------------------------------------------
// Compare is scoped to the owning document.
// ---------------------------------------------------------------------------
test("GOV-AUTH-1 BOQ compare ignores a previous extraction from another document", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE processing_logs (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_extraction_sources (id TEXT PRIMARY KEY);
    CREATE TABLE boq_sections (id TEXT PRIMARY KEY);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT, source_document_id TEXT, sequence INTEGER, item_number TEXT, description TEXT, row_type TEXT, normalized_description TEXT, original_quantity TEXT, original_unit TEXT);
    CREATE TABLE boq_extraction_evidence (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_warnings (id TEXT PRIMARY KEY);
    CREATE TABLE boq_review_decisions (id TEXT PRIMARY KEY);
    CREATE TABLE boq_revision_comparisons (id TEXT PRIMARY KEY, project_id TEXT, previous_extraction_version_id TEXT, current_extraction_version_id TEXT, added_count INTEGER, removed_count INTEGER, changed_count INTEGER, changes TEXT, created_by TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, owner_user_id TEXT, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, document_type TEXT, classification_source TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, original_filename TEXT, extension TEXT, object_key TEXT, revision TEXT, sha256 TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_classifications (id TEXT PRIMARY KEY, document_id TEXT, primary_type TEXT, status TEXT, manual_review_required INTEGER, error_code TEXT, superseded_at TEXT, classified_at TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    INSERT INTO projects VALUES ('proj-1','P','local-development-user',NULL);
    INSERT INTO documents VALUES ('doc-a','proj-1',NULL,NULL,'ver-a',NULL,NULL);
    INSERT INTO documents VALUES ('doc-b','proj-1',NULL,NULL,'ver-b',NULL,NULL);
    INSERT INTO document_versions VALUES ('ver-a','doc-a','a.xlsx','xlsx','obj-a',NULL,'sha-a',NULL,NULL);
    INSERT INTO document_versions VALUES ('ver-b','doc-b','b.xlsx','xlsx','obj-b',NULL,'sha-b',NULL,NULL);
    INSERT INTO boq_extraction_versions VALUES ('ex-a','doc-a','ver-a',1,'Completed',NULL);
    INSERT INTO boq_extraction_versions VALUES ('ex-b','doc-b','ver-b',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('item-a1','ex-a','doc-a',1,'1','Detector A','BOQ Item','detector a','5','Each');
    INSERT INTO boq_items VALUES ('item-b1','ex-b','doc-b',1,'1','FOREIGN panel XYZ','BOQ Item','foreign panel xyz','9','Each');
  `);
  const operation = (sql, args = []) => {
    const statement = raw.prepare(sql);
    return {
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => statement.run(...args),
    };
  };
  const env = {
    DB: { prepare: (sql) => ({ bind: (...args) => operation(sql, args) }), batch: async (s) => { for (const st of s) await st.run(); } },
    FILES: { get: async () => null },
  };
  try {
    const response = await handleBoqExtractionApi(
      new Request("http://localhost/api/documents/doc-a/boq-extraction/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previousExtractionVersionId: "ex-b" }),
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    // The foreign extraction contributes zero previous rows: everything current
    // reads as added, nothing as removed, and no foreign text leaks in.
    assert.equal(body.comparison.added, 1);
    assert.equal(body.comparison.removed, 0);
    assert.ok(!JSON.stringify(body.comparison.changes).includes("FOREIGN"));
    const stored = raw.prepare("SELECT * FROM boq_revision_comparisons").get();
    assert.equal(stored.project_id, "proj-1");
    assert.equal(stored.previous_extraction_version_id, "ex-b");
  } finally {
    raw.close();
  }
});

// ---------------------------------------------------------------------------
// C-1 pin: compat sub-rows flow on link authority (documented policy, no
// per-row review exists to gate on instead -- changing this would silently
// drop ALL compat content, since no writer ever mints an approved sub-row).
// ---------------------------------------------------------------------------
test("GOV-AUTH-1 compat sub-rows flow with their Confirmed link (policy pin, not a gate)", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_requirement_links (id TEXT PRIMARY KEY, boq_item_id TEXT, requirement_id TEXT, status TEXT, superseded_at TEXT);
    -- MVP-CLOSE-14: review_status added, for the same reason as above. This
    -- row ('req1') is asserting a requirement that IS approved for downstream,
    -- which in the real schema means review_status='Approved' together with
    -- approved_for_downstream=1 -- the governed approve route and the governed
    -- auto-confirm CAS write the pair together. Modelling only one of the two
    -- would describe a state the governed paths cannot produce.
    CREATE TABLE technical_requirements (id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, approved_for_downstream INTEGER, review_status TEXT);
    CREATE TABLE specification_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE engineering_facts (id TEXT PRIMARY KEY, project_id TEXT, fact_type TEXT, status TEXT, scope_type TEXT, scope_id TEXT);
    CREATE TABLE engineering_relationships (id TEXT PRIMARY KEY, project_id TEXT, scope_type TEXT, scope_id TEXT, status TEXT, relationship_type TEXT, right_entity_type TEXT, right_entity_id TEXT);
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, identity_status TEXT, superseded_by_product_id TEXT);
    CREATE TABLE requirement_attributes (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_standards (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_manufacturers (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_compatibility (id TEXT PRIMARY KEY, requirement_id TEXT, target_item TEXT, review_status TEXT);
    CREATE TABLE requirement_accessories (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_intelligence_facts (id TEXT PRIMARY KEY, profile_version_id TEXT, requirement_id TEXT, review_status TEXT, reviewed_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT);
    INSERT INTO projects VALUES ('p1',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',NULL,NULL);
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO specification_extraction_versions VALUES ('sx1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO technical_requirements VALUES ('req1','sx1','p1','doc1',1,'Approved');
    INSERT INTO boq_requirement_links VALUES ('link1','item1','req1','Confirmed',NULL);
    INSERT INTO requirement_compatibility VALUES ('compat1','req1','Panel X','Needs Review');
  `);
  try {
    const { requirements } = await loadInputs(d1(raw), { id: "item1", project_id: "p1" });
    assert.equal(requirements.length, 1);
    // The sub-row has no review of its own; it flows because its requirement
    // is current and its link is Confirmed. If a per-row compat review ever
    // exists, THIS assertion is the one that must start gating on it.
    assert.equal(requirements[0].compatibility.length, 1);
    assert.equal(requirements[0].compatibility[0].targetItem, "Panel X");
  } finally {
    raw.close();
  }
});
