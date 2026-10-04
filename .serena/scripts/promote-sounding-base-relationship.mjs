#!/usr/bin/env node
/**
 * Sprint 1.0 -- Conditional Relationship Evaluation.
 *
 * Corrects and promotes the ONE existing conditional relationship from
 * Sprint 0.9 (IDP-PHOTO-IV -> B200S-IV, Sounding Base):
 *
 *  1. Normalizes condition_json to the real Sprint 1.0 canonical contract
 *     (`{ attribute: "notification_feature", operator: "equals", value:
 *     "Sounder Required" }`) instead of the ad-hoc free-text shape Sprint 0.9
 *     used before any canonical attribute or evaluator existed.
 *  2. Promotes review_status from "Needs Review" to "Approved".
 *
 * Justification for (2) -- Sprint 1.0 Step 6 explicitly requires this NOT be
 * done merely to make a live proof pass. The reasoning: Sprint 0.9 withheld
 * approval solely because no condition-evaluation mechanism existed yet, so
 * an Approved conditional row would have leaked into EVERY IDP-PHOTO-IV match
 * unconditionally (including plain, no-sounder BOQ items) -- that was a real,
 * correct safety concern at the time. The relationship's own COMPATIBILITY
 * evidence was never weak: an official Honeywell Farenhyt datasheet lists the
 * B200SR/B200S sounder-base family as compatible with IDP-PHOTO, corroborated
 * by the real historical Al Mespar Opera Block quotation (sn11/sn12) using
 * B200S-IV specifically for the "with Sounder" BOQ line. Sprint 1.0 adds the
 * missing safety net directly (evaluateRelationshipCondition /
 * resolveRelationshipApplicability, wired into evaluateCandidate as a
 * project-condition gate that runs independently of this review_status),
 * so promoting the relationship-approval fact no longer removes any real
 * protection -- the two questions (Step 6: "is the relationship approved" vs
 * "is its condition satisfied") are now genuinely separately governed, and
 * the SATISFIED/NOT_SATISFIED/UNKNOWN/CONFLICT gate is what actually decides
 * whether this ever surfaces for a given BOQ item, not review_status alone.
 *
 * Idempotent: no-ops if condition_json/review_status already match the target
 * shape. Touches ONLY this one row's condition_json, review_status,
 * version_number, and reviewed metadata -- never product_id, accessory_product_id,
 * relationship_type, quantity fields, evidence_json, or any library_products column.
 *
 * Usage:
 *   node scripts/promote-sounding-base-relationship.mjs <db-path> --dry-run
 *   node scripts/promote-sounding-base-relationship.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: promote-sounding-base-relationship.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const findId = (partNumber) => { const row = db.prepare("SELECT id FROM library_products WHERE part_number = ?").get(partNumber); if (!row) throw new Error(`Product not found: ${partNumber}`); return row.id; };
const productId = findId("IDP-PHOTO-IV");
const accessoryId = findId("B200S-IV");

const row = db.prepare("SELECT * FROM product_accessories WHERE product_id = ? AND accessory_product_id = ? AND relationship_type = 'Sounding Base' AND superseded_at IS NULL AND deleted_at IS NULL").get(productId, accessoryId);
if (!row) throw new Error("Sprint 0.9's IDP-PHOTO-IV -> B200S-IV Sounding Base row was not found. Run Sprint 0.9's seed script first.");

const targetConditions = [{ attribute: "notification_feature", operator: "equals", value: "Sounder Required", note: "Applies only when the BOQ/specification requires audible notification (a sounder) at this detector's location -- e.g. \"Smoke Detector ... with Sounder\". Evaluated by evaluateRelationshipCondition (app/domain/product-relationship-condition-engine.mjs) against approved requirement evidence only." }];
const currentConditions = JSON.parse(row.condition_json || "[]");
const conditionsMatch = JSON.stringify(currentConditions) === JSON.stringify(targetConditions);
const alreadyApproved = row.review_status === "Approved";

console.log(`Current: review_status=${row.review_status}, condition_json=${row.condition_json}`);
if (conditionsMatch && alreadyApproved) { console.log("Already normalized and approved -- nothing to do."); process.exit(0); }

console.log(`${apply ? "UPDATING" : "WOULD UPDATE"}: review_status -> Approved, condition_json -> ${JSON.stringify(targetConditions)}`);
if (apply) {
  db.prepare("UPDATE product_accessories SET condition_json = ?, review_status = 'Approved', version_number = version_number + 1 WHERE id = ?").run(JSON.stringify(targetConditions), row.id);
  console.log("Applied.");
}
