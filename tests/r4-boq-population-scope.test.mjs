import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  currentBoqEvidenceFrom,
  currentBoqItemPredicate,
  currentBoqEligibleForEngineeringPredicate,
  currentBoqEligibleForUnderstandingPredicate,
  currentBoqEvidenceCounts,
} from "../worker/current-evidence-scope.mjs";
import { deriveEstimatorReadiness } from "../app/domain/estimator-row-readiness.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// R4 -- ONE authoritative BOQ population contract for active engineering work.
// Terminal decisions (Merged/Rejected), unresolved rows, and invalidated
// approved-family rows must not independently require Understanding, readiness,
// matching, technical approval or pricing -- but must stay visible to source
// and history read models.

// A-1 active approved; A-2 auto verified; A-3 accepted; A-4 merged (terminal);
// A-5 rejected (terminal); A-6 needs review (unresolved); A-7 approved family
// with downstream authorization invalidated; A-8 structural header.
const rows = [
  ["it-ap", "BOQ Item", "Approved", 1],
  ["it-av", "BOQ Item", "Auto Verified", 1],
  ["it-ac", "BOQ Item", "Accepted", 1],
  ["it-mg", "BOQ Item", "Merged", 0],
  ["it-mg2", "BOQ Item", "Merged", 0],
  ["it-rj", "BOQ Item", "Rejected", 0],
  ["it-nr", "BOQ Item", "Needs Review", 0],
  ["it-inv", "BOQ Item", "Approved", 0],
  ["it-hd", "Header", "Approved", 1],
];

const buildDb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT, parser_version TEXT, ruleset_version TEXT, ocr_version TEXT);
    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT,
      sequence INTEGER, row_type TEXT, description TEXT, review_status TEXT,
      approved_for_downstream INTEGER, duplicate_of_item_id TEXT, excluded_scope TEXT,
      confidence_state TEXT, extraction_confidence INTEGER, source_location TEXT,
      original_raw_values TEXT, current_values TEXT, normalized_description TEXT,
      numeric_quantity REAL, original_unit TEXT, normalized_unit TEXT, system_value TEXT,
      category TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  db.prepare("INSERT INTO organizations (id,name) VALUES ('org','Org')").run();
  db.prepare("INSERT INTO projects (id,name,organization_id) VALUES ('project','P','org')").run();
  db.prepare("INSERT INTO documents (id,project_id,current_version_id) VALUES ('doc','project','dv')").run();
  db.prepare("INSERT INTO document_versions (id,document_id) VALUES ('dv','doc')").run();
  db.prepare("INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status) VALUES ('ext','doc','dv',1,'Completed')").run();
  const ins = db.prepare("INSERT INTO boq_items (id,extraction_version_id,project_id,source_document_id,sequence,row_type,description,review_status,approved_for_downstream,confidence_state,extraction_confidence,source_location,original_raw_values,current_values) VALUES (?,'ext','project','doc',?,?,?,?,?,'High',95,'{}','{}','{}')");
  rows.forEach(([id, rowType, status, downstream], i) => ins.run(id, i + 1, rowType, `Item ${id}`, status, downstream));
  return db;
};

const listIds = (db, sql) => db.prepare(`${sql} ORDER BY b.id`).all().map((r) => r.id);
const activeIds = (db) => listIds(db, `SELECT b.id FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id='project' AND ${currentBoqEligibleForEngineeringPredicate("b")}`);
const broadIds = (db) => listIds(db, `SELECT b.id FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id='project' AND ${currentBoqItemPredicate("b")}`);

// The canonical predicate is ONE rule shared with Understanding (no divergence).
test("R4 -- Understanding and the engineering contract are the same single rule", () => {
  assert.equal(currentBoqEligibleForUnderstandingPredicate("b"), currentBoqEligibleForEngineeringPredicate("b"));
  assert.match(currentBoqEligibleForEngineeringPredicate("b"), /review_status IN \('Approved','Accepted','Auto Verified'\)/);
  assert.match(currentBoqEligibleForEngineeringPredicate("b"), /approved_for_downstream = 1/);
  // The broad predicate keeps its own valid source/history meaning.
  assert.equal(currentBoqItemPredicate("b"), "b.row_type IN ('Item','BOQ Item')");
});

// CASE A/B/C/D/E -- the active population is exactly the eligible rows.
test("R4 CASES A-E -- active engineering population excludes terminal, unresolved and invalidated rows", () => {
  const db = buildDb();
  const active = activeIds(db);
  // CASE A: eligible active rows included; CASE C: the surviving/approved rows stay eligible.
  assert.deepEqual(active, ["it-ac", "it-ap", "it-av"]);
  // CASE B: merged terminal rows are historically visible but never active.
  assert.ok(broadIds(db).includes("it-mg") && broadIds(db).includes("it-mg2"), "CASE B/H: merged rows remain in the broad source/history population");
  assert.ok(!active.includes("it-mg") && !active.includes("it-mg2"));
  // CASE D: rejected excluded. CASE E: unresolved + invalidated approved-family excluded.
  assert.ok(!active.includes("it-rj") && !active.includes("it-nr") && !active.includes("it-inv"));
  // A-8 structural header is never an active item.
  assert.ok(!active.includes("it-hd"));
});

// CASE F -- the project-wide active denominator excludes terminal rows.
test("R4 CASE F -- active denominator excludes terminal/ineligible rows while counts keep source semantics", async () => {
  const db = buildDb();
  // currentBoqEvidenceCounts speaks the D1 prepare().bind() dialect.
  const d1 = (sql) => {
    const op = (values = []) => ({
      first: async () => db.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...values) }),
    });
    return { ...op(), bind: (...values) => op(values) };
  };
  const counts = await currentBoqEvidenceCounts({ prepare: d1 }, { projectId: "project" });
  // Source/extraction totals stay BROAD on purpose (history/inventory semantics).
  assert.equal(counts.currentBoqItems, 8, "current item total keeps source/audit semantics");
  assert.equal(counts.structuralRows, 1);
  assert.equal(counts.extractionConfirmed, 3, "eligibility-scoped confirmed count");
  assert.equal(counts.extractionNeedsReview, 2, "Merged/Rejected are terminal decisions, not debt");
  // The active engineering denominator is the eligible population, not 8.
  assert.equal(activeIds(db).length, 3);
});

// The readiness denominator must be built from the active population.
test("R4 -- estimator readiness denominator is the active population, not the broad current population", () => {
  const db = buildDb();
  const active = activeIds(db);
  const rowsForReadiness = active.map((id) => ({
    boqItemId: id, rowType: "BOQ Item", description: `Item ${id}`, numericQuantity: 1,
    system: "Fire Alarm", category: "Detection Devices", understandingStatus: null,
    candidateId: null, productId: null, candidateReviewStatus: null, mandatoryFailures: "[]",
    confidenceState: null, recommendationTier: null, matchingBasis: null, lifecycleResult: "{}",
    technicalEligibility: null, technicalApprovalStatus: null, pricingLineId: null,
    selected_price_record_id: null, net_material_unit_minor: null, net_selling_minor: null,
    project_currency: "SAR", priceApprovalStatus: null, priceDownstreamUse: null,
    valid_until: null, source_location: null, sourceLocation: null, excludedScope: null,
  }));
  const { summary } = deriveEstimatorReadiness(rowsForReadiness);
  assert.equal(summary.total, 3, "readiness total is the active engineering population");
  assert.equal(summary.total, active.length);
  // No phantom blocker from merged/terminal rows.
  assert.equal(summary.excluded, 0);
});

// CASE F (workflow) -- the active workflow denominator must be reachable by the
// active population, otherwise the stage can never complete.
test("R4 -- workflow readiness gates are satisfiable by the active population", () => {
  const active = 82;
  const base = { documents: 5, classified: 5, unsupported: 0, processing: 0, failedJobs: 0, extractionReview: 0, possibleDuplicates: 0, specificationExtractions: 1, openClarifications: 0, blockingClarifications: 0, openSafetyBlocks: 0, missingPrices: 0, commercialPending: 0, finalReviewPending: 0 };
  const done = { boqItems: active, activeBoqItems: active, requirementProfiles: active, requirementReview: 0, matchedItems: active, technicalPending: 0, technicalApproved: active, pricedItems: active, commercialApproved: active, finalReviewApproved: active };
  const requirements = derivePresalesWorkflow({ project: { id: "p", name: "P", organizationId: "o", systemDomain: "Fire Alarm" }, facts: { ...base, ...done } });
  const requirementsStage = requirements.stages.find((s) => s.id === "requirements");
  assert.equal(requirementsStage.status, "Completed", "with every active row complete, the requirements stage must be able to complete");
  // The historical/current total may still be larger; it must not gate the stage.
  const inflated = derivePresalesWorkflow({ project: { id: "p", name: "P", organizationId: "o", systemDomain: "Fire Alarm" }, facts: { ...base, ...done, boqItems: 90, activeBoqItems: active } });
  const inflatedStage = inflated.stages.find((s) => s.id === "requirements");
  assert.equal(inflatedStage.status, "Completed", "a larger historical current-item total must not permanently block the active stage");
});

// Non-bypassability: every active technical consumer uses the canonical contract.
test("R4 -- active technical consumers use the canonical eligibility contract", () => {
  const readiness = read("worker/estimator-readiness-api.mjs");
  assert.match(readiness, /currentBoqEligibleForEngineeringPredicate/, "readiness population");
  const requirement = read("worker/technical-requirement-api.mjs");
  assert.match(requirement, /currentBoqEligibleForEngineeringPredicate/, "requirement-profile item boundary");
  const matching = read("worker/product-matching-api.mjs");
  assert.match(matching, /currentBoqEligibleForEngineeringPredicate/, "matching ownedItem + project-wide population");
  for (const [file, label] of [
    ["worker/pricing-runtime.mjs", "pricing input"],
    ["worker/pricing-authority.mjs", "canonical pricing readers"],
    ["worker/boq-line-bom-api.mjs", "BOM readers"],
    ["worker/boq-line-cost-api.mjs", "cost readers"],
    ["worker/fire-alarm-panel-sizing-api.mjs", "R7 panel-sizing reader"],
  ]) assert.match(read(file), /currentBoqEligibleForEngineeringPredicate/, `${label} must use the active engineering population`);
  // CASE G: an item-specific request for an ineligible row resolves no owned
  // item, so the route cannot start a match run for it.
  const ownedItemBlock = matching.slice(matching.indexOf("const ownedItem"), matching.indexOf("const ownedItem") + 900);
  assert.match(ownedItemBlock, /currentBoqEligibleForEngineeringPredicate/, "ownedItem must fail closed for terminal rows");
  // Dashboard active workflow counters use the active denominator.
  const dashboard = read("worker/dashboard-api.mjs");
  assert.match(dashboard, /activeBoqItems/, "dashboard exposes an active engineering denominator");
  const engine = read("app/domain/presales-workflow-engine.mjs");
  assert.match(engine, /activeBoqItems/, "workflow engine gates on the active denominator");
});

// Source/history read models must KEEP the broad predicate.
test("R4 -- source, history and audit read models keep the broad population", () => {
  for (const file of [
    "worker/boq-extraction-api.mjs",
    "worker/document-api.mjs",
    "worker/quotation-evidence.mjs",
    "worker/excel-export-api.mjs",
    "worker/project-pricing-learning-api.mjs",
  ]) {
    const source = read(file);
    assert.ok(
      source.includes("currentBoqItemPredicate") || source.includes("currentBoqEvidenceFrom"),
      `${file} must keep its source/history population`,
    );
    assert.ok(!source.includes("currentBoqEligibleForEngineeringPredicate"), `${file} must NOT be narrowed to the active engineering population`);
  }
  // The broad counts contract is unchanged.
  const scope = read("worker/current-evidence-scope.mjs");
  assert.match(scope, /currentExtractedRows/);
  assert.match(scope, /currentBoqItems/);
});
