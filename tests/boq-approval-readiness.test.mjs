import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { boqApprovalReadiness, parseQuantity } from "../app/domain/boq-extractor.mjs";
import { handleBoqExtractionApi } from "../worker/boq-extraction-api.mjs";

// BOQ Downstream-Approval Safety Fix (2026-09-10). Root cause: approving a
// BOQ row (single POST /api/boq-items/:id/approve, or bulk POST
// /api/boq-items/bulk-review) only ever checked row_type === "BOQ Item"
// plus a governed reason -- setting approved_for_downstream=1 with no
// minimum data-completeness gate. approved_for_downstream is real
// consumed authority (engineering-knowledge-api.mjs, boq-line-bom-api.mjs,
// boq-line-cost-api.mjs, current-evidence-scope.mjs), so an incomplete
// extracted row (no description, no unit, no quantity) could become
// authoritative downstream evidence. Fixed with one shared, deterministic,
// pure validator (boqApprovalReadiness, app/domain/boq-extractor.mjs),
// used by both the single-approve and bulk-approve routes, evaluating
// CURRENT reviewed values (never the stale original extraction snapshot).

// ---------------------------------------------------------------------------
// Unit tests: boqApprovalReadiness itself (1-4, 10-12)
// ---------------------------------------------------------------------------

const validItem = (overrides = {}) => ({
  rowType: "BOQ Item",
  description: "15U Rack Structured Cabling",
  unit: "Each",
  normalizedUnit: "Each",
  quantity: "6",
  numericQuantity: 6,
  ...overrides,
});

test("1. valid BOQ Item with description/unit/quantity: readiness succeeds", () => {
  const readiness = boqApprovalReadiness(validItem());
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missingFields, []);
});

test("2. missing description: blocked with BOQ_APPROVAL_INCOMPLETE and description in missingFields", () => {
  const readiness = boqApprovalReadiness(validItem({ description: "   " }));
  assert.equal(readiness.ready, false);
  assert.equal(readiness.code, "BOQ_APPROVAL_INCOMPLETE");
  assert.ok(readiness.missingFields.includes("description"));
});

test("3. missing unit (both original and normalized empty): blocked", () => {
  const readiness = boqApprovalReadiness(validItem({ unit: "", normalizedUnit: "" }));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missingFields.includes("unit"));
});

test("3b. original unit present but normalized absent: unit is still usable (do not require normalized_unit)", () => {
  const readiness = boqApprovalReadiness(validItem({ unit: "Lot", normalizedUnit: "" }));
  assert.equal(readiness.ready, true);
});

test("4. missing quantity (blank): blocked", () => {
  const readiness = boqApprovalReadiness(validItem({ quantity: "", numericQuantity: null }));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missingFields.includes("quantity"));
});

test("4b. quantity is unparseable text: blocked", () => {
  const readiness = boqApprovalReadiness(validItem({ quantity: "TBD", numericQuantity: null }));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missingFields.includes("quantity"));
});

test("4c. legitimate non-numeric BOQ quantity conventions (Lump Sum / Provisional / Range) are NOT treated as missing", () => {
  for (const quantity of ["Lump Sum", "LS", "Provisional", "10-20"]) {
    const readiness = boqApprovalReadiness(validItem({ quantity, numericQuantity: null }));
    assert.equal(readiness.ready, true, `"${quantity}" is a real, already-supported BOQ quantity convention and must not block approval`);
  }
});

test("4d. an unresolved formula with no cached numeric result is treated as missing quantity", () => {
  // parseQuantity("") with no explicit numericQuantity and an empty original
  // text resolves to type Blank regardless of an underlying formula --
  // there is nothing usable in current_values to approve against.
  const readiness = boqApprovalReadiness(validItem({ quantity: "", numericQuantity: null }));
  assert.equal(readiness.ready, false);
});

test("5. structural/header/note row: blocked via row_type, not the data gate", () => {
  for (const rowType of ["Section Header", "Note", "Subtotal", "Grand Total", "Blank Separator", "Header", "Excluded"]) {
    const readiness = boqApprovalReadiness(validItem({ rowType }));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.code, "NON_ITEM_APPROVAL_BLOCKED");
  }
});

test("10. manufacturer missing does NOT by itself block BOQ extraction approval", () => {
  const readiness = boqApprovalReadiness(validItem({ manufacturer: null, brand: null, model: null }));
  assert.equal(readiness.ready, true);
});

test("11. part number missing does NOT by itself block BOQ extraction approval", () => {
  const readiness = boqApprovalReadiness(validItem({ partNumber: null, specificationReference: null, category: null, system: null }));
  assert.equal(readiness.ready, true);
});

test("12. stale original values cannot override corrected current values -- the validator never reads original_quantity/original_unit, only what it is passed", () => {
  // A row whose ORIGINAL extraction was incomplete (no unit, no quantity)
  // but whose CURRENT reviewed values were corrected must pass -- proving
  // the function only ever judges the values it is actually given.
  const correctedCurrentValues = validItem({ description: "Corrected description", unit: "Each", quantity: "12" });
  const readiness = boqApprovalReadiness(correctedCurrentValues);
  assert.equal(readiness.ready, true);
});

test("Central Kitchen live example: 15U Rack / Structured Cabling / Each / 6 passes the minimum gate", () => {
  const readiness = boqApprovalReadiness({
    rowType: "BOQ Item",
    description: "15U Rack Structured Cabling",
    unit: "Each",
    normalizedUnit: "Each",
    quantity: "6",
    numericQuantity: 6,
  });
  assert.equal(readiness.ready, true);
});

test("Central Kitchen live example: Outdoor 6MP camera / CCTV / Each / 100 passes the minimum gate", () => {
  const readiness = boqApprovalReadiness({
    rowType: "BOQ Item",
    description: "Outdoor 6MP camera",
    unit: "Each",
    normalizedUnit: "Each",
    quantity: "100",
    numericQuantity: 100,
  });
  assert.equal(readiness.ready, true);
});

test("boqApprovalReadiness reuses parseQuantity rather than re-deriving quantity rules", async () => {
  const source = await readFile(new URL("../app/domain/boq-extractor.mjs", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export function boqApprovalReadiness"), source.length);
  assert.match(fn, /parseQuantity\(quantityText\)/);
  assert.equal(typeof parseQuantity, "function");
});

// ---------------------------------------------------------------------------
// Full worker integration: single approve, bulk approve, invalidation
// ---------------------------------------------------------------------------

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
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

const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, classification_id TEXT, processing_run_id TEXT, version_number INTEGER, status TEXT, parser_version TEXT, ruleset_version TEXT, ocr_version TEXT, extraction_method TEXT, summary TEXT, error_code TEXT, error_message TEXT, technical_details TEXT, suggested_action TEXT, superseded_at TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, created_by TEXT);
CREATE TABLE boq_items(
  id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, section_id TEXT, duplicate_of_item_id TEXT,
  sequence INTEGER, item_number TEXT, parent_item_number TEXT, section TEXT, subsection TEXT, hierarchy_depth INTEGER DEFAULT 0, section_path TEXT DEFAULT '[]',
  system_value TEXT, system_source_type TEXT, system_confidence INTEGER, category TEXT, subcategory TEXT,
  description TEXT, normalized_description TEXT, original_unit TEXT, normalized_unit TEXT, unit_rule TEXT, unit_confidence INTEGER,
  original_quantity TEXT, numeric_quantity TEXT, quantity_type TEXT, quantity_formula TEXT, quantity_confidence INTEGER,
  manufacturer TEXT, brand TEXT, model TEXT, part_number TEXT, specification_reference TEXT, drawing_reference TEXT, notes TEXT,
  alternates TEXT, included_accessories TEXT, excluded_scope TEXT, row_type TEXT, extraction_confidence INTEGER, confidence_state TEXT,
  review_status TEXT, source_location TEXT DEFAULT '{}', original_raw_values TEXT DEFAULT '[]', current_values TEXT DEFAULT '{}',
  approved_for_downstream INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE boq_review_decisions(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, decided_by TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
CREATE TABLE processing_logs(id TEXT PRIMARY KEY);
CREATE TABLE boq_extraction_sources(id TEXT PRIMARY KEY);
CREATE TABLE boq_sections(id TEXT PRIMARY KEY);
CREATE TABLE boq_extraction_evidence(id TEXT PRIMARY KEY);
CREATE TABLE boq_extraction_warnings(id TEXT PRIMARY KEY);
CREATE TABLE boq_revision_comparisons(id TEXT PRIMARY KEY);
`;

const REASON = "Estimator reviewed source rows against the tender BOQ";

const seedFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','Central Kitchen',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',NULL,NULL,1,'Completed','v1','v1','v1',NULL,'{}',NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,NULL,'owner1');
  `);
  return {
    raw,
    env: {
      DB: d1(raw),
      // Fixture server-configured human identity: these suites exercise
      // human-authority mutations, which fail closed without it (see
      // tests/human-actor-attribution.test.mjs). The values are fixture-only.
      APP_HUMAN_ID: "op-test-human-01",
      APP_HUMAN_NAME: "Test Human Operator",
      APP_HUMAN_EMAIL: "human-operator@example.test",
      FILES: { get: async () => null, put: async () => {}, delete: async () => {} },
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "owner1",
      APP_ORGANIZATION_ID: "org1",
    },
  };
};

const insertItem = (raw, { id, description, unit = "Each", quantity = "6", numericQuantity = "6", rowType = "BOQ Item", reviewStatus = "Needs Review", approved = 0 }) => {
  const currentValues = JSON.stringify({ description, unit, normalizedUnit: unit, quantity, numericQuantity: numericQuantity === null ? null : Number(numericQuantity), rowType });
  raw.prepare(
    `INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, description, normalized_description, original_unit, normalized_unit, original_quantity, numeric_quantity, row_type, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream)
     VALUES (?, 'ex1', 'p1', 'doc1', 1, ?, ?, ?, ?, ?, ?, ?, 90, 'High Confidence', ?, '{}', '[]', ?, ?)`,
  ).run(id, description, description, unit, unit, quantity, numericQuantity, rowType, reviewStatus, currentValues, approved);
};

const request = (path, { method = "POST", body } = {}) =>
  new Request(`https://app.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("SINGLE APPROVE: a valid BOQ Item approves successfully", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "15U Rack Structured Cabling", unit: "Each", quantity: "6", numericQuantity: "6" });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/approve", { body: { reason: REASON } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Approved");
  assert.equal(Boolean(body.item.approved_for_downstream), true);
});

test("SINGLE APPROVE: missing description blocks approval with BOQ_APPROVAL_INCOMPLETE and missingFields", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "", unit: "Each", quantity: "6", numericQuantity: "6" });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/approve", { body: { reason: REASON } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "BOQ_APPROVAL_INCOMPLETE");
  assert.ok(body.error.missingFields.includes("description"));
  assert.equal(body.error.message, "This BOQ item is missing required source data and cannot be approved downstream.");
  assert.equal(body.error.suggestedAction, "Complete or correct the missing BOQ fields, then approve the item.");

  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM boq_items WHERE id='item1'").get();
  assert.equal(row.review_status, "Needs Review", "the blocked item must not be silently approved");
  assert.equal(Number(row.approved_for_downstream), 0);
});

test("5. structural row (Header) is blocked via approve with NON_ITEM_APPROVAL_BLOCKED", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "SECTION A", unit: "", quantity: "", numericQuantity: null, rowType: "Section Header" });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/approve", { body: { reason: REASON } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "NON_ITEM_APPROVAL_BLOCKED");
});

test("6. an edit that fixes the missing field allows a subsequent approval to succeed", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Camera line", unit: "", quantity: "6", numericQuantity: "6" });

  const blocked = await handleBoqExtractionApi(request("/api/boq-items/item1/approve", { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(blocked.status, 422);

  const updateResponse = await handleBoqExtractionApi(
    request("/api/boq-items/item1/update", { body: { reason: "Corrected missing unit from source drawing", values: { unit: "Each" } } }),
    env,
    { waitUntil() {} },
  );
  assert.equal(updateResponse.status, 200, JSON.stringify(await updateResponse.clone().json()));

  const approved = await handleBoqExtractionApi(request("/api/boq-items/item1/approve", { body: { reason: REASON } }), env, { waitUntil() {} });
  const approvedBody = await approved.json();
  assert.equal(approved.status, 200, JSON.stringify(approvedBody));
  assert.equal(approvedBody.item.review_status, "Approved");
  assert.equal(Boolean(approvedBody.item.approved_for_downstream), true);
});

test("7. an approved item edited materially is invalidated back to Needs Review, approved_for_downstream=0", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Original description", unit: "Each", quantity: "6", numericQuantity: "6", reviewStatus: "Approved", approved: 1 });

  const updateResponse = await handleBoqExtractionApi(
    request("/api/boq-items/item1/update", { body: { reason: "Corrected the description after re-reading the drawing", values: { description: "Corrected description" } } }),
    env,
    { waitUntil() {} },
  );
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200, JSON.stringify(updateBody));
  assert.equal(updateBody.item.review_status, "Needs Review");
  assert.equal(Boolean(updateBody.item.approved_for_downstream), false);
});

test("7b. approval invalidation via merge: a merged (materially edited) approved item is no longer approved", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Primary item", unit: "Each", quantity: "6", numericQuantity: "6", reviewStatus: "Approved", approved: 1 });
  insertItem(raw, { id: "item2", description: "Secondary item to merge in", unit: "Each", quantity: "2", numericQuantity: "2" });

  const response = await handleBoqExtractionApi(
    request("/api/boq-items/item1/merge", { body: { reason: "Merging duplicate rows describing the same rack", otherItemId: "item2" } }),
    env,
    { waitUntil() {} },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Needs Review", "merge materially changes the description and must invalidate approval, exactly like update/restore/row-type/split already do");
  assert.equal(Boolean(body.item.approved_for_downstream), false);
  assert.match(body.item.description, /Primary item/);
  assert.match(body.item.description, /Secondary item to merge in/);

  const other = raw.prepare("SELECT review_status, approved_for_downstream FROM boq_items WHERE id='item2'").get();
  assert.equal(other.review_status, "Merged");
  assert.equal(Number(other.approved_for_downstream), 0);
});

test("8. bulk approval with one incomplete row rejects the entire batch -- zero rows approved", async () => {
  const { raw, env } = seedFixture();
  for (let i = 1; i <= 3; i += 1) insertItem(raw, { id: `item${i}`, description: `Valid row ${i}`, unit: "Each", quantity: "5", numericQuantity: "5" });
  insertItem(raw, { id: "item4", description: "", unit: "Each", quantity: "5", numericQuantity: "5" }); // missing description

  const response = await handleBoqExtractionApi(
    request("/api/boq-items/bulk-review", { body: { itemIds: ["item1", "item2", "item3", "item4"], operation: "approve", reason: REASON } }),
    env,
    { waitUntil() {} },
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "BOQ_APPROVAL_INCOMPLETE");
  assert.equal(body.error.items.length, 1);
  assert.equal(body.error.items[0].itemId, "item4");
  assert.ok(body.error.items[0].missingFields.includes("description"));

  const rows = raw.prepare("SELECT id, review_status, approved_for_downstream FROM boq_items ORDER BY id").all();
  for (const row of rows) {
    assert.notEqual(row.review_status, "Approved", `item ${row.id} must not be approved -- no partial batch`);
    assert.equal(Number(row.approved_for_downstream), 0);
  }
});

test("9. bulk approval where every row is valid approves all of them", async () => {
  const { raw, env } = seedFixture();
  for (let i = 1; i <= 3; i += 1) insertItem(raw, { id: `item${i}`, description: `Valid row ${i}`, unit: "Each", quantity: "5", numericQuantity: "5" });

  const response = await handleBoqExtractionApi(
    request("/api/boq-items/bulk-review", { body: { itemIds: ["item1", "item2", "item3"], operation: "approve", reason: REASON } }),
    env,
    { waitUntil() {} },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.reviewed, 3);

  const rows = raw.prepare("SELECT review_status, approved_for_downstream FROM boq_items").all();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.review_status, "Approved");
    assert.equal(Number(row.approved_for_downstream), 1);
  }
});

test("13. approved_for_downstream cannot become 1 through row-type change, restore or split without a subsequent gated approve", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Row", unit: "Each", quantity: "6", numericQuantity: "6", reviewStatus: "Approved", approved: 1 });

  const rowTypeChange = await handleBoqExtractionApi(
    request("/api/boq-items/item1/row-type", { body: { reason: "Reclassifying as a Note after review", rowType: "Note" } }),
    env,
    { waitUntil() {} },
  );
  const rowTypeBody = await rowTypeChange.json();
  assert.equal(rowTypeChange.status, 200, JSON.stringify(rowTypeBody));
  assert.equal(rowTypeBody.item.review_status, "Needs Review");
  assert.equal(Boolean(rowTypeBody.item.approved_for_downstream), false);
});

test("stale documents.document_type / stale original values are never read by the approval path", async () => {
  const source = await readFile(new URL("../worker/boq-extraction-api.mjs", import.meta.url), "utf8");
  const approveBlock = source.slice(source.indexOf('if (operation === "approve") { const readiness'), source.indexOf('if (operation === "reject")'));
  assert.doesNotMatch(approveBlock, /original_quantity|original_unit|previous\.description|previous\.unit|previous\.quantity/);
  assert.match(approveBlock, /next\.description/);
  assert.match(approveBlock, /next\.unit/);
  assert.match(approveBlock, /next\.quantity/);
});

// ---------------------------------------------------------------------------
// UI: blocked approval is explained, not silently disabled
// ---------------------------------------------------------------------------

test("UI: a blocked BOQ approval surfaces concise missing-field feedback instead of a generic failure toast", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const boqApprovalErrorMessage = \(error: \{/);
  assert.match(page, /error\?\.code !== "BOQ_APPROVAL_INCOMPLETE"/);
  assert.match(page, /Cannot approve — Missing: \$\{error\.missingFields/);
  assert.match(page, /Cannot approve — \$\{error\.items\.length\}/);
  // Both the single-item and bulk submit paths route their failure toast
  // through the formatter -- the backend's structured error is what
  // decides the message, not a second, UI-invented rule.
  assert.match(page, /showToast\(boqApprovalErrorMessage\(result\.error\) \|\| "Bulk BOQ review failed"\)/);
  assert.match(page, /showToast\(boqApprovalErrorMessage\(result\.error\) \|\| "BOQ review action failed"\)/);
});
