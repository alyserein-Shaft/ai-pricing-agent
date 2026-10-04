#!/usr/bin/env node
/**
 * Stage 4T — Specification Auto-Confirm + BOQ↔Requirement Linking
 *
 * Phase A: Evaluate all active requirements for auto-confirm eligibility
 * Phase B: Execute governed auto-confirm for eligible requirements
 * Phase C: Link confirmed requirements to the Golden Heat Detector BOQ item
 *
 * Uses DatabaseSync (synchronous node:sqlite) with the same gate logic
 * as worker/spec-requirement-auto-confirm.mjs.
 *
 * Usage:
 *   node scripts/spec-auto-confirm-and-link.mjs <db-path> --dry-run
 *   node scripts/spec-auto-confirm-and-link.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) {
  throw new Error("Usage: spec-auto-confirm-and-link.mjs <db-path> --dry-run|--apply");
}
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

// ─── Policy constants (mirrored from worker/spec-requirement-auto-confirm.mjs) ───
const SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION = "spec-requirement-auto-confirm-1.0.0";
const SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR = "system:spec-requirement-auto-confirm";

const NORMATIVE_MODAL = /\b(shall|must|is required|are required)\b/i;
const WEAK_PHRASING = /suitable|as required|where necessary|where applicable|as necessary/i;
const DESIGN_CHOICE = /subject to|as directed|at the (sole )?discretion|if deemed|as may be required/i;
const COMMERCIAL_QUALIFICATION =
  /years?[''']?\s+(of\s+)?experience|proven\s+(expertise|experience)|expertise\s+in\s+(installing|inspecting|testing|commissioning)|iso\s?9001|ministry of commerce|agency agreement|priced proposal|maintenance.{0,20}(contract|testing)|inspection.{0,20}testing/i;
const EXCLUDED_TECHNICAL_CATEGORIES = new Set(["Documentation", "Maintenance", "Training"]);
const PENDING_REVIEW = new Set(["Needs Review", "Pending Approval"]);

// ─── Configuration ───
const AL_MOUSA_PROJECT_ID = "project_0a49e924-1c3d-4cfb-b48a-02a66c00200c";
const GOLDEN_BOQ_ITEM_ID = "boqitem_f7fb1705-6d54-46b2-b1e8-4d2b15e421fc";
const ACTIVE_EXTRACTION_VERSION_ID = "specextract_9a1d770b-76b2-4cf9-afb6-f4aa7865c3f4";

// ─── Gate evaluator (mirrors worker logic exactly) ───
function evaluateGates(req) {
  const gates = [];
  const { review_status, requirement_type, original_text, extraction_version_id, condition, exception, system, category } = req;

  if (!PENDING_REVIEW.has(review_status)) return { eligible: false, gates: [{ gate: 1, pass: false }] };
  gates.push({ gate: 1, pass: true });

  if (requirement_type !== "Mandatory") return { eligible: false, gates: [...gates, { gate: 2, pass: false }] };
  gates.push({ gate: 2, pass: true });

  if (!NORMATIVE_MODAL.test(original_text)) return { eligible: false, gates: [...gates, { gate: 3, pass: false }] };
  gates.push({ gate: 3, pass: true });

  if (WEAK_PHRASING.test(original_text)) return { eligible: false, gates: [...gates, { gate: 4, pass: false }] };
  gates.push({ gate: 4, pass: true });

  if (extraction_version_id !== ACTIVE_EXTRACTION_VERSION_ID) return { eligible: false, gates: [...gates, { gate: 5, pass: false }] };
  gates.push({ gate: 5, pass: true });

  if ((condition && condition.trim()) || (exception && exception.trim())) return { eligible: false, gates: [...gates, { gate: 6, pass: false }] };
  gates.push({ gate: 6, pass: true });

  // Gate 7: Ambiguity/conflict (DB check) — skip for batch eval, check inline
  const amb = db.prepare("SELECT id FROM requirement_ambiguities WHERE requirement_id = ? AND status = 'Open'").get(req.id);
  const conf = db.prepare("SELECT id FROM requirement_conflicts WHERE (left_requirement_id = ? OR right_requirement_id = ?) AND resolution_status = 'Open'").get(req.id, req.id);
  if (amb || conf) return { eligible: false, gates: [...gates, { gate: 7, pass: false }] };
  gates.push({ gate: 7, pass: true });

  const sys = (system || "").trim();
  if (!sys || /^unknown$/i.test(sys)) return { eligible: false, gates: [...gates, { gate: 8, pass: false }] };
  gates.push({ gate: 8, pass: true });

  if (COMMERCIAL_QUALIFICATION.test(original_text)) return { eligible: false, gates: [...gates, { gate: 9, pass: false }] };
  gates.push({ gate: 9, pass: true });

  if (DESIGN_CHOICE.test(original_text)) return { eligible: false, gates: [...gates, { gate: 10, pass: false }] };
  gates.push({ gate: 10, pass: true });

  if (EXCLUDED_TECHNICAL_CATEGORIES.has(category)) return { eligible: false, gates: [...gates, { gate: 11, pass: false }] };
  gates.push({ gate: 11, pass: true });

  if (!original_text || !original_text.trim()) return { eligible: false, gates: [...gates, { gate: 12, pass: false }] };
  gates.push({ gate: 12, pass: true });

  return { eligible: gates.every(g => g.pass), gates };
}

// ─── Phase A: Evaluate all requirements ───
console.log("=== Phase A: Evaluate All Requirements for Auto-Confirm Eligibility ===");

const requirements = db.prepare(`
  SELECT tr.id, tr.original_text, tr.requirement_type, tr.requirement_category,
         tr.review_status, tr.approved_for_downstream, tr.system, tr.category,
         tr.condition, tr.exception, tr.extraction_version_id
  FROM technical_requirements tr
  WHERE tr.project_id = ?
    AND tr.extraction_version_id = ?
`).all(AL_MOUSA_PROJECT_ID, ACTIVE_EXTRACTION_VERSION_ID);

console.log(`Total requirements in active extraction: ${requirements.length}`);

const stats = { autoConfirmEligible: 0, humanReviewRequired: 0, alreadyApproved: 0, rejectedNoise: 0 };
const eligible = [];
const blocked = [];
const alreadyApproved = [];

for (const req of requirements) {
  if (req.review_status === "Approved") { alreadyApproved.push(req); stats.alreadyApproved += 1; continue; }
  if (!["Needs Review", "Pending Approval"].includes(req.review_status)) { stats.rejectedNoise += 1; continue; }

  const evaluation = evaluateGates(req);
  if (evaluation.eligible) { eligible.push({ requirement: req, evaluation }); stats.autoConfirmEligible += 1; }
  else { blocked.push({ requirement: req, evaluation }); stats.humanReviewRequired += 1; }
}

console.log(`\nClassification results:`);
console.log(`  AUTO_CONFIRM_ELIGIBLE: ${stats.autoConfirmEligible}`);
console.log(`  ALREADY_APPROVED: ${stats.alreadyApproved}`);
console.log(`  HUMAN_REVIEW_REQUIRED: ${stats.humanReviewRequired}`);
console.log(`  REJECTED_NOISE: ${stats.rejectedNoise}`);

// ─── Phase B: Execute auto-confirm ───
console.log("\n=== Phase B: Execute Governed Auto-Confirm ===");

if (apply && eligible.length > 0) {
  db.exec("BEGIN IMMEDIATE");
  try {
    let confirmed = 0;
    const ts = now();
    for (const { requirement } of eligible) {
      db.prepare(`
        UPDATE technical_requirements
        SET review_status = 'Approved', approved_for_downstream = 1, updated_at = ?
        WHERE id = ?
      `).run(ts, requirement.id);

      db.prepare(`
        INSERT INTO requirement_review_decisions (
          id, extraction_version_id, requirement_id, action,
          previous_value, new_value, reason, decided_by, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id("reqdecision"),
        requirement.extraction_version_id,
        requirement.id,
        "Auto-Confirm",
        JSON.stringify({ reviewStatus: requirement.review_status, approvedForDownstream: 0 }),
        JSON.stringify({ reviewStatus: "Approved", approvedForDownstream: 1 }),
        `Auto-confirmed by policy ${SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION}: all deterministic gates passed`,
        SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR,
        ts
      );
      confirmed += 1;
      console.log(`CONFIRMED: ${requirement.id} | ${requirement.original_text.slice(0, 80)}...`);
    }
    db.exec("COMMIT");
    console.log(`\nAuto-confirmed ${confirmed} requirements.`);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
} else {
  console.log(`Dry run: ${eligible.length} requirements would be auto-confirmed.`);
  const preview = eligible.slice(0, 10);
  for (const { requirement } of preview) {
    console.log(`  WOULD CONFIRM: ${requirement.id} | ${requirement.original_text.slice(0, 80)}...`);
  }
  if (eligible.length > 10) console.log(`  ... and ${eligible.length - 10} more`);
}

// ─── Phase C: Link confirmed requirements to Golden Heat Detector ───
console.log("\n=== Phase C: BOQ↔Requirement Linking for Golden Heat Detector ===");

const approvedRequirements = db.prepare(`
  SELECT tr.id, tr.original_text, tr.normalized_requirement, tr.requirement_type,
         tr.requirement_category, tr.system, tr.category, tr.subcategory
  FROM technical_requirements tr
  WHERE tr.project_id = ?
    AND tr.extraction_version_id = ?
    AND tr.review_status = 'Approved'
    AND tr.approved_for_downstream = 1
`).all(AL_MOUSA_PROJECT_ID, ACTIVE_EXTRACTION_VERSION_ID);

console.log(`Approved requirements available for linking: ${approvedRequirements.length}`);

const links = [];
const linkStats = { confirmedApplicable: 0, confirmedNotApplicable: 0, suggested: 0 };

for (const req of approvedRequirements) {
  const text = (req.original_text || "").toLowerCase();
  const isSystemWide = /system shall|system must|all components|entire system|fire alarm system/i.test(text);
  const isDeviceSpecific = /panel|facp|control panel|annunciator|repeater|power supply|battery/i.test(text);
  const isDetectorSpecific = /detector|sensor|smoke|heat|multi-criteria|beam|duct/i.test(text);
  const isModuleSpecific = /module|monitor|control module|relay|interface|isolator/i.test(text);
  const isNotificationSpecific = /sounder|strobe|horn|bell|speaker|notification/i.test(text);
  const isNetworkSpecific = /network|printer|communication|ethernet|tcp\/ip/i.test(text);

  let applicability = "SUGGESTED";
  let reason = "";

  if (isDetectorSpecific && !isDeviceSpecific) {
    applicability = "CONFIRMED_APPLICABLE"; reason = "Device-specific detection requirement"; linkStats.confirmedApplicable += 1;
  } else if (isSystemWide && !isDeviceSpecific) {
    applicability = "CONFIRMED_APPLICABLE"; reason = "System-wide requirement"; linkStats.confirmedApplicable += 1;
  } else if (isDeviceSpecific && !isDetectorSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE"; reason = "Panel/control device requirement"; linkStats.confirmedNotApplicable += 1;
  } else if (isNetworkSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE"; reason = "Network/communication requirement"; linkStats.confirmedNotApplicable += 1;
  } else if (isModuleSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE"; reason = "Module requirement"; linkStats.confirmedNotApplicable += 1;
  } else if (isNotificationSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE"; reason = "Notification device requirement"; linkStats.confirmedNotApplicable += 1;
  } else {
    applicability = "SUGGESTED"; reason = "Requires human review"; linkStats.suggested += 1;
  }

  links.push({ requirementId: req.id, text: req.original_text.slice(0, 100), category: req.requirement_category, applicability, reason });
}

console.log(`\nApplicability analysis:`);
console.log(`  CONFIRMED_APPLICABLE: ${linkStats.confirmedApplicable}`);
console.log(`  CONFIRMED_NOT_APPLICABLE: ${linkStats.confirmedNotApplicable}`);
console.log(`  SUGGESTED: ${linkStats.suggested}`);

const confirmedLinks = links.filter(l => l.applicability === "CONFIRMED_APPLICABLE");
console.log(`\nConfirmed applicable requirements for Golden Heat Detector:`);
for (const link of confirmedLinks) {
  console.log(`  ${link.requirementId} | ${link.category} | ${link.text}...`);
  console.log(`    Basis: ${link.reason}`);
}

// ─── Execute linking ───
if (apply) {
  console.log("\n=== Executing Governed BOQ↔Requirement Links ===");
  db.exec("BEGIN IMMEDIATE");
  try {
    let linked = 0;
    for (const link of confirmedLinks) {
      const existing = db.prepare("SELECT id FROM boq_requirement_links WHERE boq_item_id = ? AND requirement_id = ?").get(GOLDEN_BOQ_ITEM_ID, link.requirementId);
      if (existing) { console.log(`  SKIP (already linked): ${link.requirementId}`); continue; }

      db.prepare(`
        INSERT INTO boq_requirement_links (
          id, project_id, boq_item_id, requirement_id, status, confidence,
          source, reason, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id("bqreqlink"),
        AL_MOUSA_PROJECT_ID,
        GOLDEN_BOQ_ITEM_ID,
        link.requirementId,
        "Confirmed",
        85,
        "spec-requirement-auto-confirm",
        link.reason,
        "system:requirement-applicability-engine",
        now()
      );
      linked += 1;
      console.log(`  LINKED: ${link.requirementId} -> ${GOLDEN_BOQ_ITEM_ID}`);
    }
    db.exec("COMMIT");
    console.log(`\nCreated ${linked} governed BOQ↔Requirement links.`);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
} else {
  console.log(`\nDry run: ${confirmedLinks.length} links would be created.`);
}

// ─── Final summary ───
console.log("\n=== Final Summary ===");
console.log(`Phase A: ${requirements.length} requirements evaluated`);
console.log(`Phase B: ${apply ? eligible.length : 0} requirements auto-confirmed`);
console.log(`Phase C: ${apply ? confirmedLinks.length : 0} links created`);
console.log(`Governance invariants:`);
console.log(`  review_status changed: ${apply ? "YES (Approved for eligible)" : "NO (dry run)"}`);
console.log(`  discovery changed: NO`);
console.log(`  product data changed: NO`);
console.log(`  pricing changed: NO`);
console.log(`  matching changed: NO`);
console.log(`Taxonomy version: ${SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION}`);
console.log(`Actor: ${SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR}`);
console.log(`Project: ${AL_MOUSA_PROJECT_ID} (Al Mousa School only)`);
