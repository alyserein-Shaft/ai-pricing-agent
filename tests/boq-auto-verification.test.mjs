import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleBoqExtractionApi, executeBoqExtraction } from "../worker/boq-extraction-api.mjs";
import { currentBoqEvidenceFrom, currentBoqEvidenceCounts } from "../worker/current-evidence-scope.mjs";

// BOQ Auto-Verification (2026-09-13). A new review_status, "Auto Verified",
// means the extraction engine deterministically verified a CURRENT BOQ
// source row is a complete, clean, usable BOQ line -- NOT that a human
// approved it, matched it, priced it, or confirmed manufacturer/part/
// category. Human decision remains "Approved" (real boq_review_decisions
// row, decided_by = the authenticated user). Machine decision is
// "Auto Verified" (also a real boq_review_decisions row, but decided_by =
// a literal, honest, non-human system-actor string, action = "auto-verify",
// never one of the human-triggered operation names). Both set
// approved_for_downstream=1; both are invalidated back to Needs Review /
// approved_for_downstream=0 by the SAME unconditional-on-mutation logic in
// worker/boq-extraction-api.mjs's item-mutation endpoint.

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal), not a hand-written approximation -- see tests/fixtures/
// active-chain-fixture.mjs. That is exactly how this suite's drift showed up:
// the retired hand-written list had no `specification_extraction_versions` at
// all, so the moment executeBoqExtraction began touching the real schema the
// suite died with "no such table". Every seed row below therefore satisfies the
// REAL NOT NULL set, and FK enforcement is on because the real chain leaves it
// on (drizzle-active/0002_governing_source_fk.sql).
const buildDatabase = () => activeChainDatabase();

const REASON = "Estimator reviewed source rows against the tender BOQ";

const seedFixture = () => {
  const raw = buildDatabase();
  // A manual BOQ confirmation is a real governed chain: classification model
  // version -> document_classifications -> document_version -> document, with
  // every NOT NULL of the real tables supplied.
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org One');
    INSERT INTO classification_model_versions (id, classifier_version, ruleset_version, prompt_version, configuration) VALUES ('cmv-1','manual-1','rules-1','prompt-1','{}');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Central Kitchen','owner1','org1');
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by) VALUES ('doc1','p1','BOQ','BOQ','Manual/Unclassified','owner1');
    -- DOC-R3: both effective bounds NULL == open-past/open-future == IN FORCE, so
    -- dv1 is this document's governing version. Stated deliberately: the
    -- canonical currentness predicate reads exactly these two columns.
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('dv1','doc1',1,'boq.csv','boq.stored','csv','text/csv',4,'sha-dv1','obj1','owner1');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO document_classifications (id, document_id, document_version_id, model_version_id, primary_type, secondary_types, confidence, confidence_state, status, method, downstream_route) VALUES ('c1','doc1','dv1','cmv-1','BOQ','[]',100,'High Confidence','Manually Confirmed','manual','BOQ Extraction');
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, classification_id, processing_run_id, version_number, status, parser_version, ruleset_version, ocr_version, extraction_method, summary, error_code, error_message, technical_details, suggested_action, superseded_at, started_at, completed_at, created_by) VALUES ('ex1','doc1','dv1','c1',NULL,1,'Completed','v1','v1','v1',NULL,'{}',NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,NULL,'owner1');
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

// `sequence` is the real table's row ordinal and the table enforces
// UNIQUE(extraction_version_id, sequence); a second row in the same extraction
// therefore carries sequence 2, exactly as the extractor numbers it.
const insertItem = (raw, { id, description, sequence = 1, unit = "Each", quantity = "6", numericQuantity = "6", rowType = "BOQ Item", reviewStatus = "Needs Review", approved = 0, sourceLocation = "{}", originalRawValues = "[]" }) => {
  const currentValues = JSON.stringify({ description, unit, normalizedUnit: unit, quantity, numericQuantity: numericQuantity === null ? null : Number(numericQuantity), rowType });
  raw.prepare(
    `INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, section_path, description, normalized_description, original_unit, normalized_unit, original_quantity, numeric_quantity, row_type, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream)
     VALUES (?, 'ex1', 'p1', 'doc1', ?, '[]', ?, ?, ?, ?, ?, ?, ?, 99, 'High Confidence', ?, ?, ?, ?, ?)`,
  ).run(id, sequence, description, description, unit, unit, quantity, numericQuantity, rowType, reviewStatus, sourceLocation, originalRawValues, currentValues, approved);
};

const request = (path, { method = "POST", body } = {}) =>
  new Request(`https://app.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// 12-16: mutation invalidation of an Auto Verified row (not just Approved)
// ---------------------------------------------------------------------------

test("12. update on an Auto Verified row invalidates it to Needs Review / approved_for_downstream=0", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector", reviewStatus: "Auto Verified", approved: 1 });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/update", { body: { reason: REASON, values: { description: "Addressable smoke detector (revised)" } } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Needs Review");
  assert.equal(Boolean(body.item.approved_for_downstream), false);
});

test("13. restore on an Auto Verified row invalidates it to Needs Review / approved_for_downstream=0", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, {
    id: "item1", description: "Addressable smoke detector", reviewStatus: "Auto Verified", approved: 1,
    sourceLocation: JSON.stringify({ cells: { description: "B2" } }),
    originalRawValues: JSON.stringify(["27.01", "Addressable smoke detector (original)"]),
  });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/restore", { body: { reason: REASON, field: "description" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Needs Review");
  assert.equal(Boolean(body.item.approved_for_downstream), false);
});

test("14. row-type change on an Auto Verified row invalidates it to Needs Review / approved_for_downstream=0", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector", reviewStatus: "Auto Verified", approved: 1 });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/row-type", { body: { reason: REASON, rowType: "Section Header" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Needs Review");
  assert.equal(Boolean(body.item.approved_for_downstream), false);
});

test("15. split on an Auto Verified row invalidates the source row to Needs Review / approved_for_downstream=0", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector and beam detector", reviewStatus: "Auto Verified", approved: 1 });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/split", { body: { reason: REASON, descriptions: ["Addressable smoke detector", "Beam detector"] } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Needs Review");
  assert.equal(Boolean(body.item.approved_for_downstream), false);
});

test("16. merge on an Auto Verified row invalidates it to Needs Review / approved_for_downstream=0", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector", reviewStatus: "Auto Verified", approved: 1 });
  insertItem(raw, { id: "item2", description: "with short circuit isolator", sequence: 2, reviewStatus: "Needs Review", approved: 0 });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Needs Review");
  assert.equal(Boolean(body.item.approved_for_downstream), false);
});

// ---------------------------------------------------------------------------
// 17-18: human approve remains distinct from Auto Verified, with honest
// human provenance
// ---------------------------------------------------------------------------

test("17. human approve on a Needs Review row creates Approved, never Auto Verified", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector", unit: "Each", quantity: "50", numericQuantity: "50", reviewStatus: "Needs Review", approved: 0 });
  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/approve", { body: { reason: REASON } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Approved");
  assert.notEqual(body.item.review_status, "Auto Verified");
  assert.equal(Boolean(body.item.approved_for_downstream), true);
});

test("18. a human approval's audit decision carries honest human provenance (decided_by is the real user, not the system auto-verify actor)", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector", unit: "Each", quantity: "50", numericQuantity: "50", reviewStatus: "Needs Review", approved: 0 });
  await handleBoqExtractionApi(request("/api/boq-items/item1/approve", { body: { reason: REASON } }), env, { waitUntil() {} });
  const decision = raw.prepare("SELECT action, decided_by, reason FROM boq_review_decisions WHERE item_id='item1'").get();
  assert.equal(decision.action, "approve");
  // Human-actor attribution: the server-configured human is quoted, not the
  // ownership identity (owner1 still owns the project; attribution names the
  // human who decided). See tests/human-actor-attribution.test.mjs.
  assert.equal(decision.decided_by, "op-test-human-01");
  assert.notEqual(decision.decided_by, "BOQ Extraction Engine");
  assert.equal(decision.reason, REASON);
});

// ---------------------------------------------------------------------------
// 1, 3, 9-11, 19-21, 26: the real extraction pipeline (executeBoqExtraction)
// -- persisted approved_for_downstream, honest machine audit provenance,
// current-evidence counters, and stale-version safety across a rerun.
// ---------------------------------------------------------------------------

const csvBytes = (text) => new TextEncoder().encode(text).buffer;

const pipelineFixture = () => {
  const { raw, env } = seedFixture();
  // No pre-existing extraction version for the pipeline tests -- they create
  // their own via executeBoqExtraction.
  raw.exec("DELETE FROM boq_extraction_versions");
  // Row 1: complete, clean, zero warnings -- must Auto Verify.
  // Row 2: unrecognized unit ("Drum") -- UNIT_REVIEW warning caps confidence
  // under 90, so it stays Needs Review, but the unit is still PRESENT, so a
  // human can still approve it later (used by the stale-leak test below).
  const csv = "Item,Description,Unit,Quantity\n1,Addressable smoke detector,Each,50\n2,Fire alarm control panel,Drum,10";
  env.FILES.get = async (key) => (key === "obj1" ? { arrayBuffer: async () => csvBytes(csv) } : null);
  return { raw, env };
};

test("1 & 3. a fresh extraction persists approved_for_downstream=1 only for the Auto Verified row, 0 for the Needs Review row", async () => {
  const { raw, env } = pipelineFixture();
  const result = await executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" });
  assert.equal(result.status, "Needs Review", "the extraction VERSION is Needs Review because one row still needs review");
  const rows = raw.prepare("SELECT description, review_status, approved_for_downstream, extraction_confidence FROM boq_items WHERE extraction_version_id=? ORDER BY sequence").all(result.extractionId);
  assert.equal(rows.length, 2);
  const [clean, warned] = rows;
  assert.equal(clean.review_status, "Auto Verified");
  assert.equal(Number(clean.approved_for_downstream), 1);
  assert.ok(Number(clean.extraction_confidence) >= 90);
  assert.equal(warned.review_status, "Needs Review");
  assert.equal(Number(warned.approved_for_downstream), 0);
});

test("9, 10, 11. manufacturer/part number/category absence never blocks Auto Verification -- a plain 4-column BOQ sheet still Auto Verifies", async () => {
  const { raw, env } = pipelineFixture();
  const result = await executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" });
  const clean = raw.prepare("SELECT manufacturer, part_number, category, review_status FROM boq_items WHERE extraction_version_id=? ORDER BY sequence LIMIT 1").get(result.extractionId);
  assert.equal(clean.manufacturer, null);
  assert.equal(clean.part_number, null);
  // Wave 4B: deterministic detectCategory may now populate category for obvious
  // product types (e.g. "Addressable smoke detector" → "Detector").  The test
  // asserts that category absence never blocks Auto Verification -- a non-null
  // category from deterministic detection is fine and does not block either.
  assert.ok(clean.category === null || typeof clean.category === "string");
  assert.equal(clean.review_status, "Auto Verified");
});

test("19. Auto Verified has honest, item-level machine provenance in boq_review_decisions -- never a human decision", async () => {
  const { raw, env } = pipelineFixture();
  const result = await executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" });
  const items = raw.prepare("SELECT id, review_status FROM boq_items WHERE extraction_version_id=? ORDER BY sequence").all(result.extractionId);
  const cleanItemId = items.find((row) => row.review_status === "Auto Verified").id;
  const warnedItemId = items.find((row) => row.review_status === "Needs Review").id;

  const decisions = raw.prepare("SELECT * FROM boq_review_decisions WHERE extraction_version_id=?").all(result.extractionId);
  assert.equal(decisions.length, 1, "only the Auto Verified row gets a machine-verification decision -- the Needs Review row gets none");
  const [decision] = decisions;
  assert.equal(decision.item_id, cleanItemId);
  assert.equal(decision.action, "auto-verify");
  assert.notEqual(decision.action, "approve");
  assert.notEqual(decision.action, "update");
  assert.equal(decision.decided_by, "BOQ Extraction Engine");
  assert.notEqual(decision.decided_by, "owner1");
  assert.equal(decision.reason, "Deterministic BOQ source verification");

  const provenance = JSON.parse(decision.new_value);
  assert.equal(provenance.reviewStatus, "Auto Verified");
  assert.equal(provenance.approvedForDownstream, true);
  assert.ok(provenance.confidence >= 90);
  assert.equal(provenance.readiness.ready, true);
  assert.deepEqual(provenance.blockingWarnings, []);
  assert.equal(provenance.descriptionPresent, true);
  assert.equal(provenance.unitUsable, true);
  assert.equal(provenance.quantityUsable, true);
  assert.ok(provenance.parserVersion);

  assert.equal(decisions.some((d) => d.item_id === warnedItemId), false, "the Needs Review row must not receive any auto-verify audit entry");
});

test("20 & 21. current-evidence counters count Auto Verified as downstream-ready and never as pending", async () => {
  const { env } = pipelineFixture();
  await executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" });
  const counts = await currentBoqEvidenceCounts(env.DB, { projectId: "p1" });
  assert.equal(counts.currentBoqItems, 2);
  assert.equal(counts.extractionConfirmed, 1, "the Auto Verified row counts as downstream-ready");
  assert.equal(counts.extractionNeedsReview, 1, "only the genuinely unresolved row counts as needing review");
});

test("26. after a rerun, v1 rows -- including a human-Approved one -- no longer resolve through currentBoqEvidenceFrom, and v2's rows are what current readers see", async () => {
  const { raw, env } = pipelineFixture();
  const v1 = await executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" });
  const v1Items = raw.prepare("SELECT id, review_status FROM boq_items WHERE extraction_version_id=? ORDER BY sequence").all(v1.extractionId);
  const v1WarnedItemId = v1Items.find((row) => row.review_status === "Needs Review").id;

  // A human approves the still-usable (unit present, just unrecognized) v1
  // row before the rerun -- this is exactly the "existing 2 human Approved
  // rows" scenario the product decision describes.
  const approveResponse = await handleBoqExtractionApi(request(`/api/boq-items/${v1WarnedItemId}/approve`, { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(approveResponse.status, 200);
  const approvedRow = raw.prepare("SELECT review_status, approved_for_downstream FROM boq_items WHERE id=?").get(v1WarnedItemId);
  assert.equal(approvedRow.review_status, "Approved");
  assert.equal(Number(approvedRow.approved_for_downstream), 1);

  // Rerun: creates v2, marks v1 superseded_at.
  const v2 = await executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" });
  assert.notEqual(v2.extractionId, v1.extractionId);
  const v1Version = raw.prepare("SELECT superseded_at FROM boq_extraction_versions WHERE id=?").get(v1.extractionId);
  assert.ok(v1Version.superseded_at, "v1 must be marked superseded once v2 completes");

  // v1's rows -- Auto Verified AND the just-Approved one -- must not
  // resolve through the shared current-evidence authority any more.
  const currentRows = await env.DB.prepare(`SELECT id, extraction_version_id, review_status FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id=?`).bind("p1").all();
  const currentIds = new Set((currentRows.results || []).map((row) => row.id));
  for (const item of v1Items) assert.equal(currentIds.has(item.id), false, `v1 item ${item.id} (${item.review_status}) must not leak through currentBoqEvidenceFrom after v2 is current`);
  assert.equal(currentIds.has(v1WarnedItemId), false, "the human-Approved v1 row specifically must not leak either");
  for (const row of currentRows.results || []) assert.equal(row.extraction_version_id, v2.extractionId, "every row current readers see must belong to v2");

  // No carry-forward: v2's fresh row is evaluated purely on its own merits,
  // not on v1's prior human Approved decision for the "same" conceptual row.
  const v2Rows = await env.DB.prepare("SELECT review_status FROM boq_items WHERE extraction_version_id=? ORDER BY sequence").bind(v2.extractionId).all();
  assert.deepEqual((v2Rows.results || []).map((row) => row.review_status), ["Auto Verified", "Needs Review"], "v2's second row is freshly Needs Review again, not carried forward as Approved");
});

// ---------------------------------------------------------------------------
// 24: Pending Approval is fully retired from the extractor's own source
// ---------------------------------------------------------------------------

test("24. \"Pending Approval\" is no longer generated anywhere in the extractor's source", () => {
  const source = readFileSync(new URL("../app/domain/boq-extractor.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"Pending Approval"/);
});

// ---------------------------------------------------------------------------
// 22, 23, 25: frontend source checks (app/page.tsx)
// ---------------------------------------------------------------------------

test("22. the frontend no longer requires review_status === \"Approved\" alone for downstream-ready BOQ source evidence -- every such gate also accepts Auto Verified", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const rowTypeGateAt = "item.row_type === \"BOQ Item\" &&";
  const approvedCheck = "item.review_status === \"Approved\"";
  const autoVerifiedCheck = "item.review_status === \"Auto Verified\"";
  let matched = 0;
  for (let at = page.indexOf(approvedCheck); at !== -1; at = page.indexOf(approvedCheck, at + 1)) {
    const before = page.slice(Math.max(0, at - 220), at);
    if (!before.includes(rowTypeGateAt)) continue; // not a BOQ-item downstream-eligibility gate (e.g. a plain Needs Review counter)
    matched += 1;
    const after = page.slice(at, at + 220);
    assert.match(after, new RegExp(autoVerifiedCheck.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `this BOQ downstream-eligibility gate must also accept Auto Verified:\n${before}${after}`);
  }
  assert.ok(matched >= 3, `expected to find the known BOQ downstream-eligibility gates, found ${matched}`);
});

test("23. the UI visibly distinguishes Auto Verified from Human Approved -- a distinct CSS class and a distinct summary card", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /"review-auto-verified"/, "Auto Verified rows must render with their own CSS class, not the human-approved \"review-ready\" class");
  assert.match(page, /AUTO VERIFIED/, "the extraction summary must show a distinct Auto Verified count");
  assert.match(page, /HUMAN APPROVED/, "the extraction summary must show human approvals as a visibly separate, honestly-labeled count");

  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.review-auto-verified\s*\{/);
  const readyRule = css.match(/\.review-ready\s*\{[^}]*\}/)?.[0] || "";
  const autoVerifiedRule = css.match(/\.review-auto-verified\s*\{[^}]*\}/)?.[0] || "";
  assert.notEqual(readyRule, "");
  assert.notEqual(autoVerifiedRule, "");
  assert.notEqual(readyRule, autoVerifiedRule, "Auto Verified must not be styled identically to a human Approved row");
});

test("25. the BOQ rerun warning explicitly states human review/approval decisions are not carried forward, and that fresh rows are evaluated again under current Auto-Verification rules", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const warningMatch = page.match(/This creates a new BOQ extraction version[\s\S]{0,700}?<\/small>/);
  assert.ok(warningMatch, "the rerun confirmation warning text must exist");
  const warning = warningMatch[0];
  assert.match(warning, /new BOQ extraction version/i);
  assert.match(warning, /historical/i, "must state current rows become historical, not live, evidence");
  assert.match(warning, /not carried forward/i, "must explicitly state human decisions are not carried forward");
  assert.match(warning, /Auto-Verification|Auto Verification/i, "must mention that fresh rows are evaluated again under Auto-Verification rules");
});
