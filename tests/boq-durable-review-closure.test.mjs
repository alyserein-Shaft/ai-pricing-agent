// CLEAN_GOLDEN_BOQ_DURABLE_REVIEW_CLOSURE -- narrow tests.
//
// Proves the modal's durable wiring without touching live state: planner
// unit tests (pure), endpoint tests against isolated :memory: fixtures,
// and source-pattern tests for UI failure/retry semantics.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { planBoqReviewSubmission, chunkIds } from "../app/domain/boq-review-plan.mjs";
import { handleBoqExtractionApi, resolveBoqCandidateMembers } from "../worker/boq-extraction-api.mjs";

const OWNER = "local-development-user";
const REASON = "Reviewed repeated schedule entries against source workbook; rows are valid separate source occurrences and should remain eligible.";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE processing_logs (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, status TEXT, document_id TEXT, document_version_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE boq_extraction_sources (id TEXT PRIMARY KEY);
    CREATE TABLE boq_sections (id TEXT PRIMARY KEY);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, row_type TEXT, review_status TEXT, current_values TEXT, approved_for_downstream INTEGER, source_location TEXT, updated_at TEXT);
    CREATE TABLE boq_extraction_evidence (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_warnings (id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, code TEXT, severity TEXT, message TEXT, source_location TEXT, resolved_at TEXT);
    CREATE TABLE boq_review_decisions (id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, decided_by TEXT);
    CREATE TABLE boq_revision_comparisons (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, owner_user_id TEXT, archived_at TEXT, organization_id TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
    CREATE TABLE document_classifications (id TEXT PRIMARY KEY);
    CREATE TABLE document_audit_events (id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
  `);
  const writtenTables = [];
  const operation = (sql, args = []) => {
    const statement = raw.prepare(sql);
    return {
      first: async () => { const row = statement.get(...args); return row === undefined ? null : row; },
      all: async () => ({ results: statement.all(...args) }),
      run: async () => {
        const table = (sql.match(/^\s*(?:INSERT\s+INTO|UPDATE)\s+([A-Za-z0-9_]+)/i) || [])[1];
        if (table && !writtenTables.includes(table)) writtenTables.push(table);
        return { meta: statement.run(...args) };
      },
    };
  };
  const db = {
    prepare: (sql) => ({ bind: (...args) => operation(sql, args) }),
    batch: async (statements) => { raw.exec("BEGIN"); try { for (const s of statements) await s.run(); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; } },
  };
  raw.prepare("INSERT INTO projects VALUES (?,?,?,?,?)").run("proj-1", "P", OWNER, null, "org-1");
  raw.prepare("INSERT INTO boq_extraction_versions VALUES (?,?,?,?,?,?)").run("ver-1", "Needs Review", "doc-1", "ver-1-docver", 1, null);
  raw.prepare("INSERT INTO documents VALUES (?,?,?,?,?)").run("doc-1", "proj-1", "ver-1-docver", null, null);
  raw.prepare("INSERT INTO document_versions (id, document_id) VALUES (?,?)").run("ver-1-docver", "doc-1");
  return { raw, db, writtenTables };
};

const seedItem = (raw, { id, status = "Needs Review", approved = 0, row = 1, version = "ver-1", type = "BOQ Item" }) => raw.prepare(
  "INSERT INTO boq_items VALUES (?,?,?,?,?,?,?,?,?,?)",
).run(id, version, "proj-1", "doc-1", type, status, JSON.stringify({ description: `item ${id}`, unit: "No", normalizedUnit: "Each", quantity: "1", numericQuantity: 1 }), approved, JSON.stringify({ kind: "XLSX", sheet: "S", row }), null);

const bulk = (db, body) => handleBoqExtractionApi(
  new Request("http://localhost/api/boq-items/bulk-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  { DB: db, FILES: {} },
).then(async (response) => ({ status: response.status, body: await response.json() }));

const candidate = (id, anchors, extra = {}) => ({ id, item: `group ${id}`, unit: "No", qty: anchors.length, sourceRows: anchors, ...extra });
const acceptedDecisions = (candidates) => Object.fromEntries(candidates.map((entry) => [entry.id, "Accepted"]));

// A/B: reason is required and length-governed; failures write nothing.
test("A/B: approve without reason or with short reason is rejected with zero writes", async () => {
  const { raw, db, writtenTables } = fixture();
  seedItem(raw, { id: "i-1", status: "Needs Review" });
  for (const body of [{ itemIds: ["i-1"], operation: "approve" }, { itemIds: ["i-1"], operation: "approve", reason: "ok" }]) {
    const { status } = await bulk(db, body);
    assert.equal(status, 422);
  }
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_review_decisions").get().c, 0);
  assert.deepEqual(writtenTables, []);
  assert.equal(raw.prepare("SELECT review_status s FROM boq_items WHERE id='i-1'").get().s, "Needs Review");
});

// C: mixed group approves only the pending member.
test("C: accepted group with 8 approved + 1 pending approves exactly the pending row", async () => {
  const { raw, db } = fixture();
  const members = [];
  for (let index = 0; index < 8; index += 1) {
    seedItem(raw, { id: `ok-${index}`, status: "Approved", approved: 1, row: 10 + index });
    members.push({ itemId: `ok-${index}`, reviewStatus: "Approved" });
  }
  seedItem(raw, { id: "pend-1", status: "Needs Review", row: 20 });
  members.push({ itemId: "pend-1", reviewStatus: "Needs Review" });
  const groups = [{ id: 1, memberItemIds: members.map((m) => m.itemId), pendingItemIds: ["pend-1"], unresolvedAnchors: [] }];
  const plan = planBoqReviewSubmission({ candidates: groups, lineDecisions: { 1: "Accepted" }, exclusionReasons: {} });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.approveIds, ["pend-1"]);
  const { status, body } = await bulk(db, { itemIds: plan.approveIds, operation: "approve", reason: REASON });
  assert.equal(status, 200);
  assert.equal(body.reviewed, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_review_decisions").get().c, 1);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(raw.prepare(`SELECT review_status s FROM boq_items WHERE id='ok-${index}'`).get().s, "Approved");
  }
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_review_decisions WHERE item_id LIKE 'ok-%'").get().c, 0, "no human decisions fabricated for approved rows");
});

// D: golden-shaped case yields exactly 9 human approvals.
test("D: 81 auto + 9 pending produces exactly 9 human approvals, never 90", async () => {
  const { raw, db } = fixture();
  for (let index = 0; index < 81; index += 1) seedItem(raw, { id: `auto-${index}`, status: "Auto Verified", approved: 1, row: 1000 + index });
  for (let index = 0; index < 9; index += 1) seedItem(raw, { id: `pend-${index}`, status: "Needs Review", approved: 0, row: 2000 + index });
  const groups = [];
  for (let group = 0; group < 9; group += 1) {
    const ids = [`pend-${group}`];
    groups.push({ id: group + 1, memberItemIds: ids, pendingItemIds: ids, unresolvedAnchors: [] });
  }
  for (let group = 10; group <= 21; group += 1) {
    const ids = [];
    for (let k = 0; k < 6 && ids.length < 81; k += 1) ids.push(`auto-${(group - 10) * 6 + k}`);
    groups.push({ id: group, memberItemIds: ids, pendingItemIds: [], unresolvedAnchors: [] });
  }
  const plan = planBoqReviewSubmission({ candidates: groups, lineDecisions: acceptedDecisions(groups), exclusionReasons: {} });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.approveIds.length, 9);
  const { status } = await bulk(db, { itemIds: plan.approveIds, operation: "approve", reason: REASON });
  assert.equal(status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_review_decisions").get().c, 9);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_review_decisions WHERE item_id LIKE 'auto-%'").get().c, 0);
});

// E/F/G: anchor mapping semantics via the exported resolver.
test("E/F/G: anchors resolve by version+sheet+row, never description; structural and wrong-version rows fail closed", async () => {
  const { raw, db } = fixture();
  seedItem(raw, { id: "cur-1", status: "Needs Review", row: 11, version: "ver-1" });
  seedItem(raw, { id: "old-1", status: "Needs Review", row: 11, version: "ver-0" });
  seedItem(raw, { id: "struct-1", status: "Needs Review", row: 12, version: "ver-1", type: "Section Header" });
  seedItem(raw, { id: "dup-a", status: "Needs Review", row: 13, version: "ver-1" });
  seedItem(raw, { id: "dup-b", status: "Needs Review", row: 13, version: "ver-1" });
  const [ok, missing, structural, ambiguous] = await resolveBoqCandidateMembers(db, "ver-1", [
    candidate(1, [11]), candidate(2, [999]), candidate(3, [12]), candidate(4, [13]),
  ]);
  assert.deepEqual(ok.memberItemIds, ["cur-1"], "same-description decoy in another version never resolves");
  assert.deepEqual(ok.unresolvedAnchors, []);
  assert.deepEqual(missing.memberItemIds, []);
  assert.deepEqual(missing.unresolvedAnchors, [999]);
  assert.deepEqual(structural.memberItemIds, [], "structural rows are never targeted");
  assert.deepEqual(structural.unresolvedAnchors, [12]);
  assert.deepEqual(ambiguous.memberItemIds, []);
  assert.deepEqual(ambiguous.unresolvedAnchors, [13], "ambiguous anchors fail closed");
});

// H: exclude rejects all members with the group reason, including approved ones.
test("H: excluded group rejects every member row with its own reason", async () => {
  const { raw, db } = fixture();
  seedItem(raw, { id: "m-1", status: "Approved", approved: 1, row: 30 });
  seedItem(raw, { id: "m-2", status: "Needs Review", row: 31 });
  const groups = [{ id: 1, memberItemIds: ["m-1", "m-2"], pendingItemIds: ["m-2"], unresolvedAnchors: [] }];
  const plan = planBoqReviewSubmission({ candidates: groups, lineDecisions: { 1: "Excluded" }, exclusionReasons: { 1: "Duplicate schedule section superseded by revision." } });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.approveIds, []);
  assert.equal(plan.rejectBatches.length, 1);
  const { status } = await bulk(db, { itemIds: plan.rejectBatches[0].ids, operation: "reject", reason: plan.rejectBatches[0].reason });
  assert.equal(status, 200);
  assert.equal(raw.prepare("SELECT review_status s FROM boq_items WHERE id='m-1'").get().s, "Rejected");
  assert.equal(raw.prepare("SELECT review_status s FROM boq_items WHERE id='m-2'").get().s, "Rejected");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_review_decisions WHERE reason LIKE '%superseded by revision%'").get().c, 2);
});

// I/J: version status recompute.
test("I: resolving the final pending row flips the version to Completed", async () => {
  const { raw, db } = fixture();
  raw.prepare("INSERT INTO boq_extraction_versions VALUES (?,?,?,?,?,?)").run("ver-9", "Needs Review", "doc-1", "ver-1-docver", 1, null);
  seedItem(raw, { id: "last-1", status: "Needs Review", row: 40, version: "ver-9" });
  const { status, body } = await bulk(db, { itemIds: ["last-1"], operation: "approve", reason: REASON });
  assert.equal(status, 200);
  assert.equal(body.extractionStatus, "Completed");
  assert.equal(raw.prepare("SELECT status s FROM boq_extraction_versions WHERE id='ver-9'").get().s, "Completed");
});

test("J: version stays Needs Review while any pending row remains", async () => {
  const { raw, db } = fixture();
  raw.prepare("INSERT INTO boq_extraction_versions VALUES (?,?,?,?,?,?)").run("ver-8", "Needs Review", "doc-1", "ver-1-docver", 1, null);
  seedItem(raw, { id: "one-1", status: "Needs Review", row: 50, version: "ver-8" });
  seedItem(raw, { id: "two-1", status: "Needs Review", row: 51, version: "ver-8" });
  const { body } = await bulk(db, { itemIds: ["one-1"], operation: "approve", reason: REASON });
  assert.equal(body.extractionStatus, "Needs Review");
  assert.equal(raw.prepare("SELECT status s FROM boq_extraction_versions WHERE id='ver-8'").get().s, "Needs Review");
});

// K: warnings survive review untouched.
test("K: warnings remain present after review decisions", async () => {
  const { raw, db } = fixture();
  seedItem(raw, { id: "w-1", status: "Needs Review", row: 60 });
  raw.prepare("INSERT INTO boq_extraction_warnings VALUES (?,?,?,?,?,?,?,?)").run("warn-1", "ver-1", "w-1", "POSSIBLE_DUPLICATE", "Medium", "Possible duplicate.", "{}", null);
  await bulk(db, { itemIds: ["w-1"], operation: "approve", reason: REASON });
  const warning = raw.prepare("SELECT * FROM boq_extraction_warnings WHERE id='warn-1'").get();
  assert.ok(warning, "warning row still exists");
  assert.equal(warning.resolved_at, null, "no fabricated resolution timestamp");
});

// L: closure writes touch only review tables; no downstream surface.
test("L: bulk-review writes stay inside review tables and responses carry no downstream verdicts", async () => {
  const { raw, db, writtenTables } = (() => {
    const f = fixture();
    const seen = [];
    const origPrepare = f.db.prepare;
    f.db.prepare = (sql) => {
      const table = (sql.match(/^\s*(?:INSERT\s+INTO|UPDATE)\s+([A-Za-z0-9_]+)/i) || [])[1];
      return {
        bind: (...args) => ({
          first: async () => origPrepare(sql).bind(...args).first(),
          all: async () => origPrepare(sql).bind(...args).all(),
          run: async () => { if (table && !seen.includes(table)) seen.push(table); return origPrepare(sql).bind(...args).run(); },
        }),
      };
    };
    return { ...f, writtenTables: seen };
  })();
  seedItem(raw, { id: "l-1", status: "Needs Review", row: 70 });
  const { body } = await bulk(db, { itemIds: ["l-1"], operation: "approve", reason: REASON });
  assert.ok(writtenTables.every((table) => ["boq_items", "boq_review_decisions", "document_audit_events", "boq_extraction_versions"].includes(table)), `writes limited to review tables, got ${writtenTables}`);
  assert.ok(!("matching" in body || "pricing" in body || "quotation" in body), "response carries no downstream verdicts");
});

// M: failure preserves modal state and reason (source contract).
test("M: failed durable request must preserve modal state and the entered reason", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /boqReviewSubmitting/, "submit guard exists");
  const applyRegion = page.slice(page.indexOf("const applyKnownBoqExtraction"), page.indexOf("const closeGenericBoqPreview"));
  assert.match(applyRegion, /setBoqReviewSubmitting\(true\)/, "submit locks during requests");
  assert.match(applyRegion, /catch \(error\)/, "failure path is handled");
  assert.doesNotMatch(applyRegion, /setBoqAcceptReason\(""\)/, "failure path never clears the entered reason");
  assert.doesNotMatch(applyRegion, /setBoqLineDecisions\(\{\}\)/, "failure path never clears decisions");
});
