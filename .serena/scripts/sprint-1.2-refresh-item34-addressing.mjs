#!/usr/bin/env node
/**
 * Sprint 1.2 -- Step 12 governed refresh.
 *
 * item 34 "Manual Call Point MCLP" carries a STALE, invalid interpretation:
 * validated_interpretation.attributes.addressing.value === "MCLP". Directly
 * tested against the CURRENT, live validateAttributeValue("Fire Alarm",
 * "addressing", "MCLP") -- it returns { valid:false, normalizedValue:null }.
 * The stored interpretation (version 1, created 2026-08-23 14:28:44) predates
 * this validator being applied to it -- validation runs once at merge/storage
 * time (validateAndMergeBoqInterpretation), never re-applied on read, so the
 * stale rejected value has sat there unrefreshed ever since.
 *
 * Per Sprint 1.2 Step 12: do NOT redesign semantic validation; do not
 * direct-edit the approval record; use the normal governed refresh/review
 * path. This script does exactly that -- same real functions as
 * scripts/sprint-1.0-approve-opera-smoke-detectors.mjs.
 *
 * IMPORTANT -- a second, real evidence gap was discovered while building this
 * refresh (see the long comment below): this item DOES have real, approved
 * confirmedSpecification evidence proving "individually addressable"
 * (requirement page 32: "Manual pull stations shall be individually
 * addressable..."), but including that evidence in taxonomy candidate
 * detection collides with a DIFFERENT registered family ("Pull Station"),
 * making the candidate ambiguous. The reconciliation fix from Sprint 1.0
 * requires the STORED interpretation's input_fingerprint to be computed with
 * the item's REAL confirmedSpecification (not an empty array) or the review
 * system will never recognize it as current -- so this refresh cannot simply
 * omit confirmedSpecification to dodge the collision. The honest, non-forced
 * outcome is stored below: category/equipmentType/productFamily and
 * addressing all remain genuinely MISSING (not "MCLP", not a guessed
 * "Addressable"), with the real reason recorded in ambiguities. This
 * refresh does NOT attempt to force an APPROVE_INTERPRETATION -- an
 * interpretation that cannot resolve basic classification is correctly left
 * AWAITING_REVIEW for a human engineer (or a future, explicitly-scoped
 * taxonomy fix) to resolve, not synthetically pushed through.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";
import { loadUnderstandingReviewRows } from "../worker/estimator-understanding-review-api.mjs";
import { confirmedSpecifications } from "../worker/estimator-understanding-api.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.2-refresh-item34-addressing.mjs <db-path>");
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
const ITEM_ID = "boqitem_f034a3f4-7270-414a-975c-62f8f1b60a21"; // item 34, "Manual Call Point MCLP"

const f = (value, origin = "EXTRACTED", confidence = 100) => ({ value, origin, confidence });
const realRowFields = (item) => ({ boqItemId: item.id, id: item.id, rowType: item.row_type, description: item.description, numericQuantity: String(item.numeric_quantity), originalQuantity: String(item.original_quantity), normalizedUnit: item.normalized_unit, originalUnit: item.original_unit, system: item.system_value, category: item.category, subcategory: item.subcategory, manufacturer: item.manufacturer, model: item.model, partNumber: item.part_number, currentValues: JSON.parse(item.current_values || "{}"), sourceLocation: JSON.parse(item.source_location || "null") });

const item = raw.prepare("SELECT * FROM boq_items WHERE id = ?").get(ITEM_ID);
console.log(`=== Item ${item.item_number}: "${item.description}" ===`);

const specsByItem = await confirmedSpecifications(DB, PROJECT_ID);
const confirmedSpecification = specsByItem[item.id] || [];
console.log("Real confirmedSpecification on file for this item:", JSON.stringify(confirmedSpecification.map((s) => ({ id: s.id, normalizedRequirement: s.normalizedRequirement, page: s.sourceLocation?.pageFrom }))));

// Must use the REAL confirmedSpecification for the stored input -- Sprint
// 1.0's reconciliation fix requires this to match what a live recomputation
// will use, or the review system will report CURRENT_AUTHORITY_INVALID
// forever (confirmed by hitting exactly that error when this script first
// tried using an empty array to dodge the collision below).
const input = prepareBoqUnderstandingInput(realRowFields(item), confirmedSpecification);
const candidate = input.taxonomyContext.families[0];
console.log("taxonomy candidate (with real confirmedSpecification):", candidate ? JSON.stringify(candidate) : "none -- see ambiguities below");

const collisionAmbiguity = "Confirmed spec text (\"pull stations\") also matches the separate \"Pull Station\" family, colliding with this item's own \"Manual Call Point\" match -- true synonyms, no taxonomy alias. Not fixed here (Sprint 1.2, out of scope).";

const response = {
  normalizedDescription: f(item.description),
  taxonomyCandidateKey: candidate ? f(candidate.selectionKey, "INFERRED", 85) : f(null, "MISSING", 0),
  system: f("Fire Alarm"),
  category: candidate ? f(candidate.category) : f(null, "MISSING", 0),
  equipmentType: candidate ? f(candidate.family) : f(null, "MISSING", 0),
  productFamily: candidate ? f(candidate.family) : f(null, "MISSING", 0),
  technicalAttributes: [],
  standards: [],
  manufacturerEvidence: [],
  compatibilityRequirements: [],
  requiredAccessories: [],
  searchTerms: candidate ? [f(candidate.family.toLowerCase())] : [],
  missingInformation: candidate ? [] : [f("category", "INFERRED", 100), f("equipmentType", "INFERRED", 100), f("productFamily", "INFERRED", 100), f("addressing", "INFERRED", 100)],
  ambiguities: candidate ? [] : [f(collisionAmbiguity, "INFERRED", 100)],
  confidence: "LOW",
};
const merged = validateAndMergeBoqInterpretation(input, response);
console.log("merge status:", merged.status, "| category:", JSON.stringify(merged.interpretation.category), "| productFamily:", JSON.stringify(merged.interpretation.productFamily));
console.log("addressing:", JSON.stringify(merged.interpretation.attributes?.addressing ?? "not present (productFamily unresolved -- attribute normalization never runs)"));
if (JSON.stringify(merged.interpretation.attributes?.addressing?.value) === '"MCLP"') throw new Error("Refusing to store: MCLP would still be present -- refresh did not work.");

const inputFingerprint = interpretationInputFingerprint(input);
const existing = raw.prepare("SELECT id FROM estimator_item_interpretations WHERE boq_item_id=? AND input_fingerprint=? AND config_fingerprint=?").get(item.id, inputFingerprint, "sprint-1.2-refresh-cfg");
if (existing) {
  console.log(`Interpretation already exists for this exact input (id=${existing.id}) -- no insert needed.`);
} else {
  const runId = `understandingrun_${randomUUID()}`;
  const priorVersion = raw.prepare("SELECT COALESCE(MAX(version_number),0) v FROM estimator_item_interpretations WHERE boq_item_id=?").get(item.id).v;
  const interpId = `interp_${randomUUID()}`;
  const organizationId = raw.prepare("SELECT organization_id FROM projects WHERE id=?").get(PROJECT_ID).organization_id;
  raw.prepare(`INSERT INTO estimator_understanding_runs (id, project_id, organization_id, provider, model, model_version, prompt_version, schema_version, config_fingerprint, status, total_items, processed_items, successful_items, review_items, failed_items, requested_by, run_mode) VALUES (?, ?, ?, 'sprint-1.2-deterministic-refresh', 'sprint-1.2-deterministic-refresh', '1', '1', '1', 'sprint-1.2-refresh-cfg', 'COMPLETED', 1, 0, 0, 1, 0, 'local-development-user', 'CONTROLLED_PILOT')`).run(runId, PROJECT_ID, organizationId);
  raw.prepare(`INSERT INTO estimator_item_interpretations (id, run_id, project_id, boq_item_id, version_number, input_fingerprint, config_fingerprint, provider, model, model_version, prompt_version, schema_version, status, raw_response, validated_interpretation, error_code, error_message, created_by, created_at) VALUES (?,?,?,?,?,?,?,'sprint-1.2-deterministic-refresh','sprint-1.2-deterministic-refresh','1','1','1',?,?,?,NULL,NULL,'local-development-user',CURRENT_TIMESTAMP)`)
    .run(interpId, runId, PROJECT_ID, item.id, priorVersion + 1, inputFingerprint, "sprint-1.2-refresh-cfg", merged.status, JSON.stringify(response), JSON.stringify(merged.interpretation));
  console.log(`Stored as new interpretation version ${priorVersion + 1} (id=${interpId}), superseding the stale MCLP version through normal append-only versioning.`);
}

// Deliberately does NOT call mutateUnderstandingReview/APPROVE_INTERPRETATION
// -- an interpretation with unresolved category/equipmentType/productFamily
// is correctly not approvable, and should not be forced to be. It remains
// AWAITING_REVIEW, which is the honest state.
//
// Reads the REAL, RECONCILED current proposal (row.effective.proposal) --
// deliberately NOT a naive "ORDER BY version_number DESC LIMIT 1" raw query,
// which would surface a dead-end exploratory attempt row from earlier in
// this refresh (version 4, fingerprinted with an empty confirmedSpecification
// array) instead of the fingerprint-reconciled current one. This is exactly
// the class of mistake Sprint 1.0's reconciliation fix exists to prevent in
// the real governed code; using the real resolver here proves this script's
// own conclusion is reconciliation-correct too, not just version-order-correct.
const row = (await loadUnderstandingReviewRows(DB, PROJECT_ID)).find((entry) => entry.boqItemId === item.id);
console.log("Real governed current state:", JSON.stringify({ reviewStatus: row?.review?.status, proposalState: row?.effective?.state, taxonomyValid: row?.taxonomyValid }));
const currentAddressing = row?.effective?.proposal?.attributes?.addressing ?? null;
console.log("Reconciled CURRENT addressing value:", JSON.stringify(currentAddressing));
console.log(currentAddressing?.value === "MCLP" ? "FAIL: MCLP is still present as the current authoritative addressing evidence." : "CONFIRMED: 'MCLP' is not the current authoritative addressing evidence -- it can never enter capacity demand.");
