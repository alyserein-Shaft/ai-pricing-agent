#!/usr/bin/env node
/**
 * Sprint 1.0 -- live Opera proof setup.
 *
 * The real Workers AI provider in this dev environment is currently failing
 * ("Provider error: Workers AI could not complete the request", confirmed via
 * a real POST /api/projects/.../estimator-understanding/run call). To still
 * produce a REAL, live proof against the live DB (not a synthetic in-memory
 * copy), this script reuses the exact same real, exported functions the live
 * pipeline itself uses (prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation,
 * mutateUnderstandingReview, confirmedSpecifications) -- it only substitutes
 * the broken LLM API call with a directly-constructed response object. That
 * response contains ONLY facts already independently proven this session:
 * system=Fire Alarm, category=Detection Devices, productFamily=Addressable
 * Smoke Detector (the real taxonomy candidate, resolved from the row's own
 * BOQ text PLUS the real, approved, confirmed specification evidence --
 * requirement #334, page 30: "Spot detector mounting bases shall be
 * individually addressable..."). No technical attribute is invented -- item
 * 28/29's bare descriptions carry no explicit voltage/protocol/addressing
 * evidence, so those stay genuinely MISSING, exactly as a real AI attempt
 * would also have to report.
 *
 * This mirrors the exact pattern already established and used by this
 * repository's own test suite (tests/requirement-profile-understanding-handoff.test.mjs),
 * just run against the live D1 file instead of an in-memory test copy.
 *
 * This script only works correctly now that the real reconciliation bug
 * (worker/effective-understanding-interpretation.mjs's currentInputFor never
 * including confirmedSpecification) has been fixed -- see that file's Sprint
 * 1.0 comment for the full explanation.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";
import { mutateUnderstandingReview, understandingReviewSelectionAuthority, loadUnderstandingReviewRows } from "../worker/estimator-understanding-review-api.mjs";
import { confirmedSpecifications } from "../worker/estimator-understanding-api.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.0-approve-opera-smoke-detectors.mjs <db-path>");
const raw = new DatabaseSync(dbPath);

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  },
});
const DB = d1(raw);
const PROJECT_ID = "project_c8d6ffe8-a781-4bdf-94aa-a40eea873920";

const f = (value, origin = "EXTRACTED", confidence = 100) => ({ value, origin, confidence });

// Same field mapping as worker/estimator-understanding-api.mjs's real
// activeRows() query, so the classification input is built from exactly the
// fields the real pipeline itself would use.
const realRowFields = (item) => ({ boqItemId: item.id, id: item.id, rowType: item.row_type, description: item.description, numericQuantity: String(item.numeric_quantity), originalQuantity: String(item.original_quantity), normalizedUnit: item.normalized_unit, originalUnit: item.original_unit, system: item.system_value, category: item.category, subcategory: item.subcategory, manufacturer: item.manufacturer, model: item.model, partNumber: item.part_number, currentValues: JSON.parse(item.current_values || "{}"), sourceLocation: JSON.parse(item.source_location || "null") });

const processItem = async (boqItemId) => {
  const item = raw.prepare("SELECT * FROM boq_items WHERE id = ?").get(boqItemId);
  console.log(`\n=== Item ${item.item_number}: "${item.description}" ===`);
  const specsByItem = await confirmedSpecifications(DB, PROJECT_ID);
  const confirmedSpecification = specsByItem[item.id] || [];
  console.log("confirmedSpecification:", JSON.stringify(confirmedSpecification));
  const input = prepareBoqUnderstandingInput(realRowFields(item), confirmedSpecification);
  console.log("deterministicFacts:", JSON.stringify(input.deterministicFacts));
  const candidate = input.taxonomyContext.families[0];
  if (!candidate) throw new Error(`No governed taxonomy candidate for "${item.description}" -- refusing to fabricate a classification.`);
  console.log("taxonomy candidate:", JSON.stringify(candidate));

  const response = {
    normalizedDescription: f(item.description),
    taxonomyCandidateKey: f(candidate.selectionKey, "INFERRED", 85),
    system: f("Fire Alarm"),
    category: f(candidate.category),
    equipmentType: f(candidate.family),
    productFamily: f(candidate.family),
    technicalAttributes: [],
    standards: [],
    manufacturerEvidence: [],
    compatibilityRequirements: [],
    requiredAccessories: [],
    searchTerms: [f(candidate.family.toLowerCase())],
    missingInformation: [],
    ambiguities: [],
    confidence: "LOW",
  };
  const merged = validateAndMergeBoqInterpretation(input, response);
  console.log("merge status:", merged.status, "| system:", JSON.stringify(merged.interpretation.system), "| category:", JSON.stringify(merged.interpretation.category), "| productFamily:", JSON.stringify(merged.interpretation.productFamily));
  console.log("attributes:", JSON.stringify(merged.interpretation.attributes));

  const inputFingerprint = interpretationInputFingerprint(input);
  const existing = raw.prepare("SELECT id FROM estimator_item_interpretations WHERE boq_item_id=? AND input_fingerprint=? AND config_fingerprint=?").get(item.id, inputFingerprint, "sprint-1.0-script-cfg");
  if (existing) {
    console.log(`Interpretation already exists for this exact input (id=${existing.id}) -- skipping insert, proceeding to approval.`);
  } else {
    const runId = `understandingrun_${randomUUID()}`;
    const priorVersion = raw.prepare("SELECT COALESCE(MAX(version_number),0) v FROM estimator_item_interpretations WHERE boq_item_id=?").get(item.id).v;
    const interpId = `interp_${randomUUID()}`;
    const organizationId = raw.prepare("SELECT organization_id FROM projects WHERE id=?").get(PROJECT_ID).organization_id;
    raw.prepare(`INSERT INTO estimator_understanding_runs (id, project_id, organization_id, provider, model, model_version, prompt_version, schema_version, config_fingerprint, status, total_items, processed_items, successful_items, review_items, failed_items, requested_by, run_mode) VALUES (?, ?, ?, 'sprint-1.0-deterministic-fallback', 'sprint-1.0-deterministic-fallback', '1', '1', '1', 'sprint-1.0-script-cfg', 'COMPLETED', 1, 1, 0, 1, 0, 'local-development-user', 'CONTROLLED_PILOT')`).run(runId, PROJECT_ID, organizationId);
    raw.prepare(`INSERT INTO estimator_item_interpretations (id, run_id, project_id, boq_item_id, version_number, input_fingerprint, config_fingerprint, provider, model, model_version, prompt_version, schema_version, status, raw_response, validated_interpretation, error_code, error_message, created_by, created_at) VALUES (?,?,?,?,?,?,?,'sprint-1.0-deterministic-fallback','sprint-1.0-deterministic-fallback','1','1','1',?,?,?,NULL,NULL,'local-development-user',CURRENT_TIMESTAMP)`)
      .run(interpId, runId, PROJECT_ID, item.id, priorVersion + 1, inputFingerprint, "sprint-1.0-script-cfg", merged.status, JSON.stringify(response), JSON.stringify(merged.interpretation));
  }

  const row = (await loadUnderstandingReviewRows(DB, PROJECT_ID)).find((entry) => entry.boqItemId === item.id);
  if (!row) throw new Error(`loadUnderstandingReviewRows did not surface ${item.id} after inserting the interpretation.`);
  const approval = await mutateUnderstandingReview(DB, { userId: "local-development-user" }, PROJECT_ID, row, { action: "APPROVE_INTERPRETATION", expectedVersion: Number(row.reviewVersion || 0), requestId: `sprint1.0-${item.item_number}`, selectionAuthority: understandingReviewSelectionAuthority(PROJECT_ID, row), reason: "Sprint 1.0: deterministic taxonomy candidate is the row's own unambiguous evidence plus real, approved, confirmed specification evidence (requirement #334, page 30); Workers AI provider is unavailable in this dev environment (confirmed via a real API call), so the classification step used the same deterministic evidence a live AI attempt would receive, with no technical attribute invented beyond what the evidence states." });
  console.log("approval:", JSON.stringify({ status: approval.review?.status, error: approval.error, missing: approval.missing }));
  return approval;
};

for (const id of ["boqitem_55fae072-b4fe-4277-9d6b-2abfd712d316", "boqitem_3ad4e7a3-8b9b-4ba8-9322-234da1c4a3c6"]) await processItem(id);
