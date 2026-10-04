// Phase 1 residual closure: zero-denominator workflow semantics and review queue
// population debt. The review-queue fixture is built on the ACTUAL active
// migration chain (drizzle-active journal), not on a hand-written approximation.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { handleReviewWorkflowApi } from "../worker/review-workflow-api.mjs";

const ACTIVE_ROOT = new URL("../drizzle-active", import.meta.url).pathname.replace(/\/$/, "");

const applyActiveChain = (db) => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  for (const entry of journal.entries) {
    const sql = readFileSync(join(ACTIVE_ROOT, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
};

const project = { id: "p", name: "P", organizationId: "o", systemDomain: "Fire Alarm" };
const workflow = (facts) => derivePresalesWorkflow({ project, facts });

test("a real zero active population is not replaced by the broader BOQ source total", () => {
  const terminalOnly = workflow({
    documents: 2, classified: 2, boqItems: 5, activeBoqItems: 0,
    specificationExtractions: 1, requirementProfiles: 0, matchedItems: 0,
    technicalApproved: 0, pricedItems: 0, commercialApproved: 0, finalReviewApproved: 0,
  });
  for (const id of ["requirements", "selection", "technical", "supplier", "costing", "quotation"]) {
    assert.notEqual(terminalOnly.stages.find((s) => s.id === id).status, "Completed", `${id} must not complete over an empty active denominator`);
  }
  assert.equal(terminalOnly.readyForQuotation, false);
});

test("a caller that supplies no activeBoqItems is identical to one supplying it as the full boqItems count", () => {
  const facts = {
    documents: 2, classified: 2, boqItems: 2, specificationExtractions: 1,
    requirementProfiles: 2, matchedItems: 2, technicalApproved: 2, pricedItems: 2,
    commercialApproved: 2, finalReviewApproved: 2,
  };
  const implicit = workflow(facts);
  const explicit = workflow({ ...facts, activeBoqItems: facts.boqItems });
  assert.deepEqual(implicit.stages, explicit.stages);
  assert.equal(implicit.readyForQuotation, explicit.readyForQuotation);
  assert.equal(implicit.readyForQuotation, true);
});

const d1 = (raw) => ({
  prepare(sql) {
    const op = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...op(), bind: (...args) => op(args) };
  },
  async batch(statements) {
    raw.exec("BEGIN");
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      raw.exec("COMMIT");
      return out;
    } catch (e) { raw.exec("ROLLBACK"); throw e; }
  },
});

const seedActualChain = () => {
  const directory = mkdtempSync(join(tmpdir(), "queue-debt-"));
  const db = new DatabaseSync(join(directory, "queue.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyActiveChain(db);
  db.prepare("INSERT INTO projects (id, name, owner_user_id) VALUES ('p', 'P', 'u1')").run();
  db.prepare("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p', 'boq.pdf', 'u1')").run();
  db.prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('dv1', 'd1', 1, 'boq.pdf', 'boq.stored', 'pdf', 'application/pdf', 4, 'sum1', 'projects/boq.pdf', 'u1')").run();
  db.prepare("UPDATE documents SET current_version_id='dv1' WHERE id='d1'").run();
  db.prepare("INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES ('ev1', 'd1', 'dv1', 1, 'Completed', 'parser-v1', 'rules-v1', 'ocr-v1', 'u1')").run();
  const rows = [
    ["active-1", "Approved active row", "Approved", 1, 1, 95],
    ["merged-1", "Merged terminal row", "Merged", 0, 2, 95],
    ["rejected-1", "Rejected terminal row", "Rejected", 0, 3, 95],
    ["needs-review-1", "Unresolved row", "Needs Review", 0, 4, 95],
  ];
  for (const [id, description, reviewStatus, approved, sequence, confidence] of rows) {
    db.prepare("INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, section_path, row_type, description, review_status, approved_for_downstream, extraction_confidence, confidence_state, source_location, original_raw_values, current_values, item_number, numeric_quantity, original_quantity, normalized_unit, original_unit, system_value, category) VALUES (?, 'ev1', 'p', 'd1', ?, 'Building A', 'BOQ Item', ?, ?, ?, ?, 'High', 'p1.pdf#B12', '{}', '{}', ?, 2, 2, 'EA', 'EA', 'Fire Alarm', 'Detectors')").run(id, sequence, description, reviewStatus, approved, confidence, String(sequence));
  }
  return { db, close: () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
};

const env = (raw) => ({ DB: d1(raw), APP_ACCESS_MODE: "single-user", APP_USER_ID: "u1", APP_USER_ORGANIZATION_ID: "o", APP_ORGANIZATION_ID: "o" });

test("review queue sync creates Final Estimation Review debt only for the active population", async () => {
  const { db, close } = seedActualChain();
  try {
    const response = await handleReviewWorkflowApi(new Request("https://app.example/api/reviews/projects/p/sync", { method: "POST" }), env(db));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.created, 1, "only the active approved row may create new queue debt");
    const queued = db.prepare("SELECT boq_item_id FROM review_queue_items ORDER BY boq_item_id").all().map((r) => r.boq_item_id);
    assert.deepEqual(queued, ["active-1"]);
  } finally { close(); }
});

test("review queue read routes still surface already-queued terminal rows so they can be closed", async () => {
  const { db, close } = seedActualChain();
  try {
    db.prepare("INSERT INTO review_queue_items (id, project_id, boq_item_id, review_type, priority, priority_score, severity, status, required_role, blocking, source_module, reason_for_review, required_decision, approval_level, safety_state, entity_version, version_number, escalation_status, created_by) VALUES ('rq-merged', 'p', 'merged-1', 'Final Estimation Review', 'High', 10, 'High', 'Waiting for Technical Approval', 'Technical Manager', 1, 'Safety and Pricing', 'legacy debt', 'Approve', 1, 'Approval Ready', 1, 1, 'None', 'u1')").run();
    const response = await handleReviewWorkflowApi(new Request("https://app.example/api/reviews/projects/p/queue"), env(db));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items.some((item) => item.id === "rq-merged"), true, "existing queue debt must remain visible");
  } finally { close(); }
});
