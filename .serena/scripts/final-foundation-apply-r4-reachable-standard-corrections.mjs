#!/usr/bin/env node
/**
 * FINAL FOUNDATION BLOCKER -- apply the 2 audited R4 corrections that are reachable by live matching.
 *
 * The final blocker audit found that, of the 1,460 R4-defective requirement_standards rows,
 * exactly 2 are loaded by the live matching input path (worker/technical-requirement-api.mjs
 * loadInputs: CURRENT extraction AND confirmed boq_requirement_links AND approved_for_downstream=1):
 *   1. UL 268 with part "Standard"      -> keep UL 268, clear the invalid part      (R4: PART_IS_A_WORD)
 *   2. IEEE with number "Standard"      -> clear the malformed number component    (R4: NUMBER_IS_A_WORD)
 * Both corrections are exactly the REPLACE_IDENTITY entries already computed by the R4 dry-run.
 * No other requirement_standards row is touched (the remaining historical R4 rows are non-blocking
 * debt: none is reachable).
 *
 * Safety:
 *   - --verify is read-only. It re-derives the reachable defective set from the live DB and proves it
 *     is exactly these 2 rows with exactly the audited values (else
 *     FINAL_FOUNDATION_STANDARD_REPAIR_DRIFT, nothing written).
 *   - --apply needs a verified pre-change backup (--backup <file>), re-verifies inside ONE
 *     BEGIN IMMEDIATE transaction, updates the 2 rows, records one decision per requirement in the
 *     EXISTING engineering_knowledge_decisions table (no new table), asserts the end state and only
 *     then COMMITs. Any failure rolls everything back.
 *   - No status change, approval, link, profile, match-run, compatibility or product write.
 *
 * Usage:
 *   node scripts/final-foundation-apply-r4-reachable-standard-corrections.mjs <db> --verify
 *   node scripts/final-foundation-apply-r4-reachable-standard-corrections.mjs <db> --apply --backup <backup.sqlite>
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { CURRENT_TECHNICAL_REQUIREMENT_SQL } from "../worker/current-evidence-scope.mjs";
import { cleanDesignation, isStandardsBody } from "../app/domain/standards-citations.mjs";

const [dbPath, mode, ...rest] = process.argv.slice(2);
if (!dbPath || !["--verify", "--apply"].includes(mode)) throw new Error("Usage: <db-path> --verify | --apply --backup <backup.sqlite>");
const backupPath = rest[0] === "--backup" ? rest[1] : null;
const apply = mode === "--apply";
if (apply && !backupPath) throw new Error("--apply requires --backup <verified pre-change backup>");

const REPAIR_VERSION = "FINAL-FOUNDATION-R4-REACHABLE-1";
const REASON = "FINAL_FOUNDATION_R4_REACHABLE_STANDARD_CORRECTION";
const ACTION = "r4-standard-identity-correction";
const ACTOR = "system:final-foundation-r4-reachable-standard-correction";

// The audited rows (values are the final blocker audit's, verbatim) and the R4 plan correction.
const TARGETS = [
  {
    id: "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_30_standard_1",
    requirementId: "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_30",
    audited: { body: "UL", number: "268", part: "Standard", year: null, original_text: "UL 268 - Standard", status: "Informational", confidence: 94 },
    defect: "PART_IS_A_WORD", correction: { number: "268", part: null },
  },
  {
    id: "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_326_standard_1",
    requirementId: "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_326",
    audited: { body: "IEEE", number: "Standard", part: null, year: null, original_text: "IEEE Standard", status: "Mandatory", confidence: 94 },
    defect: "NUMBER_IS_A_WORD", correction: { number: null, part: null },
  },
];
const TARGET_IDS = new Set(TARGETS.map((target) => target.id));

const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const fp = (value) => sha(value).slice(0, 16);
const fail = (code, detail) => { const error = new Error(`${code}: ${detail}`); error.code = code; throw error; };
const drift = (detail) => fail("FINAL_FOUNDATION_STANDARD_REPAIR_DRIFT", detail);

const db = new DatabaseSync(dbPath, { readOnly: !apply });
db.exec("PRAGMA busy_timeout = 15000");
if (apply) db.exec("PRAGMA foreign_keys = ON");
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

// ---- reachability: exactly the live matching input gate ---------------------------------------
const REACHABLE_STANDARDS_SQL = `SELECT DISTINCT s.* FROM requirement_standards s
  JOIN (${CURRENT_TECHNICAL_REQUIREMENT_SQL}) r ON r.id = s.requirement_id
  JOIN boq_requirement_links l ON l.requirement_id = r.id AND l.superseded_at IS NULL AND l.status = 'Confirmed'
  WHERE r.approved_for_downstream = 1 ORDER BY s.id`;
const reachableRows = () => all(REACHABLE_STANDARDS_SQL);

// Independent R4 defect test (same defect classes as the R4 plan): malformed identity, not a plan lookup.
const WORD = /^[A-Za-z]{3,}$/;
const identityDefects = (row) => {
  const defects = [];
  if (!isStandardsBody(row.body)) defects.push("NOT_A_STANDARDS_BODY");
  for (const field of ["number", "part"]) {
    const value = row[field];
    if (value == null) continue;
    if (WORD.test(String(value))) defects.push(`${field.toUpperCase()}_IS_A_WORD`);
    const cleaned = cleanDesignation(String(value));
    if (cleaned.truncated) defects.push(`${field.toUpperCase()}_TRUNCATED`);
    else if (cleaned.artifacts.length && cleaned.designation !== value) defects.push(`${field.toUpperCase()}_ARTIFACT`);
  }
  return defects;
};
const reachableDefective = () => reachableRows().map((row) => ({ id: row.id, defects: identityDefects(row) })).filter((entry) => entry.defects.length);

const verifyReviewedState = () => {
  const problems = [];
  const reachable = reachableRows();
  const reachableIds = reachable.map((row) => row.id).sort();
  if (JSON.stringify(reachableIds) !== JSON.stringify([...TARGET_IDS].sort())) problems.push(`reachable standards rows are ${JSON.stringify(reachableIds)}, expected exactly the 2 audited rows`);
  const defective = reachableDefective().map((entry) => entry.id).sort();
  if (JSON.stringify(defective) !== JSON.stringify([...TARGET_IDS].sort())) problems.push(`reachable defective rows are ${JSON.stringify(defective)}, expected exactly the 2 audited rows`);
  for (const target of TARGETS) {
    const row = one("SELECT * FROM requirement_standards WHERE id = ?", target.id);
    if (!row) { problems.push(`${target.id}: missing`); continue; }
    for (const [field, expected] of Object.entries(target.audited)) if ((row[field] ?? null) !== expected) problems.push(`${target.id}: ${field} is ${JSON.stringify(row[field])}, audited ${JSON.stringify(expected)}`);
    if (row.requirement_id !== target.requirementId) problems.push(`${target.id}: requirement_id changed`);
    const requirement = one(`SELECT approved_for_downstream a, review_status s FROM (${CURRENT_TECHNICAL_REQUIREMENT_SQL}) r WHERE r.id = ?`, target.requirementId);
    if (!requirement || requirement.a !== 1) problems.push(`${target.requirementId}: not current + approved_for_downstream`);
    if (!one("SELECT id FROM boq_requirement_links WHERE requirement_id = ? AND superseded_at IS NULL AND status = 'Confirmed'", target.requirementId)) problems.push(`${target.requirementId}: no confirmed link`);
  }
  if (one("SELECT COUNT(*) n FROM engineering_knowledge_decisions WHERE reason = ?", REASON).n > 0) problems.push("repair decision records already exist (already applied?)");
  return problems;
};

// Everything the repair must NOT change.
const snapshot = () => {
  const golden = "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_197";
  return {
    technical_requirements: fp(all("SELECT id, review_status, approved_for_downstream, requirement_type, requirement_category, original_text FROM technical_requirements ORDER BY id")),
    boq_requirement_links: fp(all("SELECT id, status, superseded_at, requirement_id, boq_item_id FROM boq_requirement_links ORDER BY id")),
    requirement_profile_versions: fp(all("SELECT id, version_number, status, approved_for_matching, superseded_at, profile FROM requirement_profile_versions ORDER BY id")),
    product_match_runs: fp(all("SELECT * FROM product_match_runs ORDER BY id")),
    product_match_candidates: fp(all("SELECT id, match_run_id, technical_status, review_status, mandatory_failures FROM product_match_candidates ORDER BY id")),
    library_products: fp(all("SELECT id, updated_at, review_status FROM library_products ORDER BY id")),
    product_attributes: fp(all("SELECT id, superseded_at, deleted_at FROM product_attributes ORDER BY id")),
    requirement_compatibility: fp(all("SELECT * FROM requirement_compatibility ORDER BY id")),
    requirement_attributes: fp(all("SELECT * FROM requirement_attributes ORDER BY id")),
    requirement_manufacturers: fp(all("SELECT * FROM requirement_manufacturers ORDER BY id")),
    requirement_standards_other_rows: fp(all(`SELECT * FROM requirement_standards WHERE id NOT IN (${[...TARGET_IDS].map(() => "?").join(",")}) ORDER BY id`, ...TARGET_IDS)),
    requirement_standards_total: one("SELECT COUNT(*) n FROM requirement_standards").n,
    golden_197: fp({
      requirement: one("SELECT * FROM technical_requirements WHERE id = ?", golden),
      attributes: all("SELECT * FROM requirement_attributes WHERE requirement_id = ? ORDER BY id", golden),
      standards: all("SELECT * FROM requirement_standards WHERE requirement_id = ? ORDER BY id", golden),
      compatibility: all("SELECT * FROM requirement_compatibility WHERE requirement_id = ? ORDER BY id", golden),
    }),
    decisions_total: one("SELECT COUNT(*) n FROM engineering_knowledge_decisions").n,
  };
};

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const report = { mode, repairVersion: REPAIR_VERSION };

const preProblems = verifyReviewedState();
if (preProblems.length) { console.error(`FINAL_FOUNDATION_STANDARD_REPAIR_DRIFT\n - ${preProblems.join("\n - ")}`); process.exit(3); }
console.log(`PRE-APPLY VERIFY OK: reachable standards rows = ${reachableRows().length} (exactly the 2 audited rows), reachable defective rows = ${reachableDefective().length}, both rows match the audit values, both requirements are current + approved_for_downstream=1 + confirmed-linked.`);
if (!apply) { console.log(JSON.stringify(TARGETS.map((target) => ({ id: target.id, before: one("SELECT body, number, part, year, original_text, status, confidence FROM requirement_standards WHERE id = ?", target.id), plannedCorrection: target.correction, defect: target.defect })), null, 2)); console.log("Verify only: no write."); db.close(); process.exit(0); }

// ---- backup proof ---------------------------------------------------------------------------
{
  const size = statSync(backupPath).size;
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  const quick = backup.prepare("PRAGMA quick_check").get();
  for (const target of TARGETS) {
    const row = backup.prepare("SELECT * FROM requirement_standards WHERE id = ?").get(target.id);
    if (!row || Object.entries(target.audited).some(([field, expected]) => (row[field] ?? null) !== expected)) fail("FINAL_FOUNDATION_BACKUP_INVALID", `backup row ${target.id} does not match the audited state`);
  }
  const counts = { standards: backup.prepare("SELECT COUNT(*) n FROM requirement_standards").get().n, decisions: backup.prepare("SELECT COUNT(*) n FROM engineering_knowledge_decisions").get().n, requirements: backup.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n };
  backup.close();
  const live = { standards: one("SELECT COUNT(*) n FROM requirement_standards").n, decisions: one("SELECT COUNT(*) n FROM engineering_knowledge_decisions").n, requirements: one("SELECT COUNT(*) n FROM technical_requirements").n };
  if (Object.values(quick)[0] !== "ok" || JSON.stringify(counts) !== JSON.stringify(live)) fail("FINAL_FOUNDATION_BACKUP_INVALID", `quick_check=${Object.values(quick)[0]} counts backup=${JSON.stringify(counts)} live=${JSON.stringify(live)}`);
  report.backup = { path: backupPath, bytes: size, sha256: sha256File(backupPath), quick_check: "ok", counts };
  console.log(`BACKUP VERIFIED: ${backupPath} (${size} bytes, sha256 ${report.backup.sha256.slice(0, 16)}..., quick_check ok, counts match live, target rows identical)`);
}

const before = snapshot();
const beforeRows = Object.fromEntries(TARGETS.map((target) => [target.id, { ...one("SELECT * FROM requirement_standards WHERE id = ?", target.id) }]));
const timestamp = new Date().toISOString();

// ---- ONE transaction ------------------------------------------------------------------------
let outcome;
db.exec("BEGIN IMMEDIATE");
try {
  const midProblems = verifyReviewedState();
  if (midProblems.length) drift(`changed between verify and transaction: ${midProblems.join("; ")}`);
  const decisionIds = [];
  for (const target of TARGETS) {
    const result = db.prepare("UPDATE requirement_standards SET number = ?, part = ? WHERE id = ? AND body = ? AND requirement_id = ?")
      .run(target.correction.number, target.correction.part, target.id, target.audited.body, target.requirementId);
    if (result.changes !== 1) fail("FINAL_FOUNDATION_WRITE_ASSERT", `update ${target.id} changed ${result.changes} rows`);
    const afterRow = { ...one("SELECT * FROM requirement_standards WHERE id = ?", target.id) };
    const project = one("SELECT project_id FROM technical_requirements WHERE id = ?", target.requirementId).project_id;
    const decisionId = `knowledgeDecision_r4reachable_${fp(target.id)}`;
    const evidence = { repairVersion: REPAIR_VERSION, timestamp, actor: ACTOR, source: "R4 dry-run plan REPLACE_IDENTITY", defect: target.defect, standardRowId: target.id, before: beforeRows[target.id], after: afterRow, gate: "current extraction AND confirmed link AND approved_for_downstream=1", scope: "only the 2 rows reachable by live matching; remaining historical R4 rows untouched" };
    const inserted = db.prepare("INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, reversible, decided_by, decided_role) VALUES (?, ?, 'Technical Requirement', ?, ?, ?, ?, ?, ?, 'Project', ?, 1, ?, 'System')")
      .run(decisionId, project, target.requirementId, ACTION, JSON.stringify({ standard: beforeRows[target.id] }), JSON.stringify({ standard: afterRow }), REASON, JSON.stringify(evidence), project, ACTOR);
    if (inserted.changes !== 1) fail("FINAL_FOUNDATION_WRITE_ASSERT", `decision ${decisionId} not inserted`);
    decisionIds.push(decisionId);
  }
  // ---- end-state assertions (a failure rolls back) ----
  const assert = (condition, detail) => { if (!condition) fail("FINAL_FOUNDATION_END_STATE_ASSERT", detail); };
  const ul = one("SELECT * FROM requirement_standards WHERE id = ?", TARGETS[0].id);
  assert(ul.body === "UL" && ul.number === "268" && ul.part === null && ul.year === null && ul.original_text === "UL 268 - Standard" && ul.status === "Informational" && ul.confidence === 94, "UL row must be UL 268 with no part and all other fields unchanged");
  const ieee = one("SELECT * FROM requirement_standards WHERE id = ?", TARGETS[1].id);
  assert(ieee.body === "IEEE" && ieee.number === null && ieee.part === null && ieee.year === null && ieee.original_text === "IEEE Standard" && ieee.status === "Mandatory" && ieee.confidence === 94, "IEEE row must have no number/part and all other fields unchanged");
  assert(reachableDefective().length === 0, "REACHABLE_DEFECTIVE_STANDARD_ROWS must be 0");
  assert(reachableRows().length === 2, "the same 2 rows must remain reachable");
  assert(one("SELECT COUNT(*) n FROM requirement_standards").n === before.requirement_standards_total, "requirement_standards count changed");
  assert(one("SELECT COUNT(*) n FROM engineering_knowledge_decisions").n === before.decisions_total + 2, "decision total mismatch");
  db.exec("COMMIT");
  outcome = { committed: true, rowsUpdated: TARGETS.length, decisionRecords: decisionIds };
} catch (error) {
  try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
  console.error(`TRANSACTION ROLLED BACK -- nothing was written. ${error.message}`);
  process.exit(4);
}

const after = snapshot();
const unexpected = Object.keys(before).filter((key) => key !== "decisions_total" && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
console.log(JSON.stringify({
  outcome,
  rows: TARGETS.map((target) => ({ id: target.id, before: beforeRows[target.id], after: { ...one("SELECT * FROM requirement_standards WHERE id = ?", target.id) } })),
  reachableDefectiveStandardRows: reachableDefective().length,
  deltas: { decisions: [before.decisions_total, after.decisions_total], requirement_standards_total: [before.requirement_standards_total, after.requirement_standards_total] },
  unchangedProtectedSnapshots: Object.keys(before).filter((key) => key !== "decisions_total" && !unexpected.includes(key)),
  unexpectedChanges: unexpected,
  integrity_check: Object.values(one("PRAGMA integrity_check"))[0],
}, null, 2));
if (unexpected.length) { console.error(`UNEXPECTED CHANGE in protected snapshot: ${unexpected.join(", ")}`); process.exit(5); }
db.close();
