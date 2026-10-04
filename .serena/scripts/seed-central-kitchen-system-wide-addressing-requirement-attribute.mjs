#!/usr/bin/env node
/**
 * Fire Alarm E2E fix (requirement applicability mechanism) -- real Central
 * Kitchen - Makkah gap: the confirmed, project-scoped requirement "The
 * entire fire detection system shall be analogue addressable type" (Doc
 * page 186, "28 30 00 FIRE DETECTION AND ALARM") carries NO structured
 * attribute at all -- the deterministic specification extractor recorded it
 * as pure free text (requirement_attributes: []). Even once this
 * requirement is confirmed-applicable to a BOQ item (see
 * propagate-system-wide + the new allSystemCategories path), matching
 * validation has nothing to compare a candidate's own addressing attribute
 * against without a structured requirement-side fact -- exactly the same
 * requirement_attributes shape already used for req_345 (see
 * scripts/seed-idp-heat-ror-attribute-evidence.mjs).
 *
 * Structures one fact, taken directly and only from this requirement's own
 * already-extracted, already-approved text ("...shall be analogue
 * addressable type"): addressing = "Addressable". Nothing else is added --
 * no protocol, no standard, no other attribute -- since the clause states
 * nothing else structurally.
 *
 * This script is scoped to this ONE project-specific confirmed requirement
 * row -- it does not touch any product, any other requirement, or any
 * taxonomy/family definition.
 *
 * Idempotent: skips if this requirement already has an `addressing` fact.
 *
 * Usage:
 *   node scripts/seed-central-kitchen-system-wide-addressing-requirement-attribute.mjs <db-path> --dry-run
 *   node scripts/seed-central-kitchen-system-wide-addressing-requirement-attribute.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-central-kitchen-system-wide-addressing-requirement-attribute.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const REQUIREMENT_ID = "specjob_f29a4cbd-328c-4296-b6dc-c0e1218bd2f7_chunk_000004_requirement_647";

const getRequirement = db.prepare("SELECT id, project_id, normalized_requirement, review_status, approved_for_downstream FROM technical_requirements WHERE id = ?");
const getExistingAttrs = db.prepare("SELECT name FROM requirement_attributes WHERE requirement_id = ?");
const insertAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)");

let added = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  const requirement = getRequirement.get(REQUIREMENT_ID);
  if (!requirement) throw new Error(`Requirement not found: ${REQUIREMENT_ID}`);
  if (requirement.review_status !== "Approved" || !requirement.approved_for_downstream) throw new Error("Requirement must already be Approved/approved_for_downstream before structuring its attribute (governance order: approve the clause, then structure it).");
  const existing = getExistingAttrs.all(REQUIREMENT_ID);
  if (existing.some((entry) => norm(entry.name) === "addressing")) { console.log("SKIP (already present): requirement_647 -> addressing"); skipped += 1; }
  else {
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_647 -> addressing = "Addressable"`);
    if (apply) insertAttr.run(id("reqattr"), REQUIREMENT_ID, "addressing", "Equal", "The entire fire detection system shall be analogue addressable type", "Addressable", 90, JSON.stringify({ pageFrom: 186, pageTo: 186, clausePath: ["28 30 00 FIRE DETECTION AND ALARM", "2 PRODUCTS", "1 The entire fire detection system shall be analogue addressable type"] }));
    added += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${added} attribute${added === 1 ? "" : "s"} ${apply ? "added" : "would be added"}, ${skipped} skipped.`);
