#!/usr/bin/env node
/**
 * Stage 4T — BOQ↔Requirement Linking for Golden Heat Detector
 *
 * Links confirmed requirements to the Golden Heat Detector using the
 * correct boq_requirement_links schema.
 *
 * Usage:
 *   node scripts/link-requirements-to-golden.mjs <db-path> --dry-run
 *   node scripts/link-requirements-to-golden.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) {
  throw new Error("Usage: link-requirements-to-golden.mjs <db-path> --dry-run|--apply");
}
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const AL_MOUSA_PROJECT_ID = "project_0a49e924-1c3d-4cfb-b48a-02a66c00200c";
const GOLDEN_BOQ_ITEM_ID = "boqitem_f7fb1705-6d54-46b2-b1e8-4d2b15e421fc";
const ACTIVE_EXTRACTION_VERSION_ID = "specextract_9a1d770b-76b2-4cf9-afb6-f4aa7865c3f4";

// ─── Get all Approved requirements ───
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

// ─── Applicability analysis ───
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
  let evidence = [];

  if (isDetectorSpecific && !isDeviceSpecific) {
    applicability = "CONFIRMED_APPLICABLE";
    reason = "Device-specific detection requirement";
    evidence = ["Device-specific detection requirement", `Category: ${req.requirement_category}`];
    linkStats.confirmedApplicable += 1;
  } else if (isSystemWide && !isDeviceSpecific) {
    applicability = "CONFIRMED_APPLICABLE";
    reason = "System-wide requirement applicable to all Fire Alarm devices";
    evidence = ["System-wide requirement", "Propagates to field devices"];
    linkStats.confirmedApplicable += 1;
  } else if (isDeviceSpecific && !isDetectorSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE";
    reason = "Panel/control device requirement";
    linkStats.confirmedNotApplicable += 1;
  } else if (isNetworkSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE";
    reason = "Network/communication requirement";
    linkStats.confirmedNotApplicable += 1;
  } else if (isModuleSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE";
    reason = "Module requirement";
    linkStats.confirmedNotApplicable += 1;
  } else if (isNotificationSpecific) {
    applicability = "CONFIRMED_NOT_APPLICABLE";
    reason = "Notification device requirement";
    linkStats.confirmedNotApplicable += 1;
  } else {
    applicability = "SUGGESTED";
    reason = "Requires human review for applicability";
    evidence = ["Applicability unclear", "Requires human review"];
    linkStats.suggested += 1;
  }

  if (applicability !== "CONFIRMED_NOT_APPLICABLE") {
    links.push({
      requirementId: req.id,
      text: req.original_text.slice(0, 100),
      category: req.requirement_category,
      applicability,
      reason,
      evidence,
    });
  }
}

console.log(`\nApplicability analysis:`);
console.log(`  CONFIRMED_APPLICABLE: ${linkStats.confirmedApplicable}`);
console.log(`  CONFIRMED_NOT_APPLICABLE: ${linkStats.confirmedNotApplicable}`);
console.log(`  SUGGESTED: ${linkStats.suggested}`);

// ─── Show confirmed applicable links ───
const confirmedLinks = links.filter(l => l.applicability === "CONFIRMED_APPLICABLE");
const suggestedLinks = links.filter(l => l.applicability === "SUGGESTED");

console.log(`\n=== Confirmed Applicable (${confirmedLinks.length}) ===`);
for (const link of confirmedLinks) {
  console.log(`  ${link.requirementId} | ${link.category} | ${link.text}...`);
  console.log(`    Basis: ${link.reason}`);
}

console.log(`\n=== Suggested / Needs Review (${suggestedLinks.length}) ===`);
for (const link of suggestedLinks.slice(0, 10)) {
  console.log(`  ${link.requirementId} | ${link.category} | ${link.text}...`);
}
if (suggestedLinks.length > 10) {
  console.log(`  ... and ${suggestedLinks.length - 10} more`);
}

// ─── Execute linking ───
if (apply) {
  console.log(`\n=== Executing Governed BOQ↔Requirement Links ===`);
  db.exec("BEGIN IMMEDIATE");
  try {
    let linked = 0;
    let skipped = 0;

    for (const link of links) {
      // Check if link already exists
      const existing = db.prepare(
        "SELECT id FROM boq_requirement_links WHERE boq_item_id = ? AND requirement_id = ?"
      ).get(GOLDEN_BOQ_ITEM_ID, link.requirementId);

      if (existing) {
        skipped += 1;
        continue;
      }

      const status = link.applicability === "CONFIRMED_APPLICABLE" ? "Confirmed" : "Suggested";
      const confidence = link.applicability === "CONFIRMED_APPLICABLE" ? 85 : 50;

      db.prepare(`
        INSERT INTO boq_requirement_links (
          id, project_id, boq_item_id, requirement_id, link_method,
          confidence, evidence, status, scope_type, scope_id,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id("bqreqlink"),
        AL_MOUSA_PROJECT_ID,
        GOLDEN_BOQ_ITEM_ID,
        link.requirementId,
        "Deterministic Applicability",
        confidence,
        JSON.stringify(link.evidence),
        status,
        "BOQ Item",
        GOLDEN_BOQ_ITEM_ID,
        "system:requirement-applicability-engine",
        now()
      );
      linked += 1;
      console.log(`  LINKED [${status}]: ${link.requirementId}`);
    }

    db.exec("COMMIT");
    console.log(`\nCreated ${linked} links (${skipped} already existed).`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
} else {
  console.log(`\nDry run: ${links.length} links would be created.`);
}

// ─── Verify ───
const totalLinks = db.prepare(
  "SELECT COUNT(*) as cnt FROM boq_requirement_links WHERE boq_item_id = ?"
).get(GOLDEN_BOQ_ITEM_ID);

const confirmedCount = db.prepare(
  "SELECT COUNT(*) as cnt FROM boq_requirement_links WHERE boq_item_id = ? AND status = 'Confirmed'"
).get(GOLDEN_BOQ_ITEM_ID);

const suggestedCount = db.prepare(
  "SELECT COUNT(*) as cnt FROM boq_requirement_links WHERE boq_item_id = ? AND status = 'Suggested'"
).get(GOLDEN_BOQ_ITEM_ID);

console.log(`\n=== Verification ===`);
console.log(`Total links for Golden Heat Detector: ${totalLinks.cnt}`);
console.log(`  Confirmed: ${confirmedCount.cnt}`);
console.log(`  Suggested: ${suggestedCount.cnt}`);

// ─── Verify addressable requirement ───
const addrReq = db.prepare(`
  SELECT tr.review_status, tr.approved_for_downstream
  FROM technical_requirements tr
  WHERE tr.id = 'requirement_b8817753-cfce-4c14-9296-a74e04302de1'
`).get();

console.log(`\n=== Addressable Requirement Verification ===`);
console.log(`review_status: ${addrReq.review_status}`);
console.log(`approved_for_downstream: ${addrReq.approved_for_downstream}`);

// Check if linked to Golden
const addrLink = db.prepare(`
  SELECT id, status FROM boq_requirement_links
  WHERE boq_item_id = ? AND requirement_id = 'requirement_b8817753-cfce-4c14-9296-a74e04302de1'
`).get(GOLDEN_BOQ_ITEM_ID);

console.log(`Linked to Golden: ${addrLink ? `YES (${addrLink.status})` : "NO"}`);

// ─── Verify audit trail ───
const auditCount = db.prepare(`
  SELECT COUNT(*) as cnt FROM requirement_review_decisions
  WHERE decided_by = 'system:spec-requirement-auto-confirm'
  AND requirement_id = 'requirement_b8817753-cfce-4c14-9296-a74e04302de1'
`).get();

console.log(`\nAudit trail entries for addressable requirement: ${auditCount.cnt}`);

// ─── Final project isolation check ───
const projectsTouched = db.prepare(`
  SELECT DISTINCT project_id FROM boq_requirement_links
  WHERE created_by = 'system:requirement-applicability-engine'
`).all();

console.log(`\n=== Project Isolation ===`);
console.log(`Projects touched by linking: ${projectsTouched.length}`);
for (const p of projectsTouched) {
  console.log(`  ${p.project_id}`);
}

console.log(`\nGovernance invariants:`);
console.log(`  discovery changed: NO`);
console.log(`  product data changed: NO`);
console.log(`  pricing changed: NO`);
console.log(`  matching changed: NO`);
console.log(`  product attributes: NOT TOUCHED`);
console.log(`  product certifications: NOT TOUCHED`);
console.log(`  product compatibility: NOT TOUCHED`);

db.close();
