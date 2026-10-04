#!/usr/bin/env node
/**
 * R1-DATA -- apply the reviewed P6/P7 data correction set.
 *
 * Independent closure audit repair R1 (data step). Corrects the 10 wrong or
 * ambiguous P6/P7-seeded requirement_attributes rows found by the audit and
 * confirmed by the R1 dry-run. Reviewed plan: 6 pure deletes, 4 replacements
 * (old row removed, one correct row inserted under a NEW deterministic id),
 * 7 rows kept untouched.
 *
 * Safety:
 *   - --verify is read-only: proves every targeted row still fingerprints
 *     exactly as reviewed (else R1_DATA_REPAIR_DRIFT, nothing written).
 *   - --apply needs a verified pre-repair backup (--backup <file>), re-verifies
 *     inside ONE BEGIN IMMEDIATE transaction, applies deletes/inserts/decision
 *     records, asserts the end state, and only then COMMITs (any failure
 *     rolls back everything; no partial apply).
 *   - Audit trail uses the EXISTING engineering_knowledge_decisions table
 *     (entity_type 'Technical Requirement', action 'r1-semantic-correction');
 *     no new table.
 *   - No status change, approval, link, profile, matching or product write.
 *
 * Usage:
 *   node scripts/r1-apply-p6-p7-data-correction.mjs <db-path> --verify
 *   node scripts/r1-apply-p6-p7-data-correction.mjs <db-path> --apply --backup <backup.sqlite>
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extractAttributes } from "../app/domain/specification-extractor.mjs";

const [dbPath, mode, ...rest] = process.argv.slice(2);
if (!dbPath || !["--verify", "--apply"].includes(mode)) throw new Error("Usage: r1-apply-p6-p7-data-correction.mjs <db-path> --verify | --apply --backup <backup.sqlite>");
const backupPath = rest[0] === "--backup" ? rest[1] : null;
const apply = mode === "--apply";
if (apply && !backupPath) throw new Error("--apply requires --backup <verified pre-repair backup>");

const REPAIR_VERSION = "R1-DATA-1";
const REASON = "R1_P6_P7_SEMANTIC_CORRECTION";
const ACTOR = "system:r1-p6-p7-semantic-correction";
const JOB = "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_";
const req = (n) => `${JOB}requirement_${n}`;

// [attribute id, reviewed action, name, operator, reviewed row fingerprint]
const REVIEWED_ROWS = [
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_141_attribute_p0_battery_autonomy_323420686f757273",
  "KEEP_AS_IS",
  "battery_autonomy",
  "Minimum",
  "6f3ce0412e5bb14c"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_278_attribute_p0_battery_autonomy_323420686f757273",
  "KEEP_AS_IS",
  "battery_autonomy",
  "Equals",
  "8dacfda44bb18e11"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_323_attribute_p0_battery_capacity_323030204148",
  "DELETE_BAD_FACT",
  "battery_capacity",
  "Equals",
  "08f4972d56684092"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_261_attribute_p0_candela_rating_31352f3735206364",
  "DELETE_BAD_FACT",
  "candela_rating",
  "Equals",
  "00ac48dd6be7e6ff"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_261_attribute_p0_candela_rating_33302f3132302063",
  "DELETE_BAD_FACT",
  "candela_rating",
  "Equals",
  "74e7eb255a098b9b"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_187_attribute_p0_humidity_range_393525",
  "REPLACE_WITH_CORRECT_FACT",
  "humidity_range",
  "Equals",
  "46be5273fa3879d6"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_244_attribute_p0_humidity_range_393525",
  "REPLACE_WITH_CORRECT_FACT",
  "humidity_range",
  "Equals",
  "ff422331939d89e4"
 ],
 [
  "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_387_attribute_sound_output",
  "KEEP_AS_IS",
  "sound_output",
  "Minimum",
  "213aa9705d971c34"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_249_attribute_p0_sound_output_313520644241",
  "DELETE_BAD_FACT",
  "sound_output",
  "Minimum",
  "c7f10c59661f0287"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_249_attribute_p0_sound_output_3520644241",
  "DELETE_BAD_FACT",
  "sound_output",
  "Equals",
  "22dfd0ad704b6de0"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_250_attribute_p0_sound_output_31313020644241",
  "REPLACE_WITH_CORRECT_FACT",
  "sound_output",
  "Excludes",
  "62b16049901a19cd"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_250_attribute_p0_sound_output_363520644241",
  "DELETE_BAD_FACT",
  "sound_output",
  "Excludes",
  "fd416a5f08c4c1b1"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_251_attribute_p0_sound_output_373520644241",
  "KEEP_AS_IS",
  "sound_output",
  "Minimum",
  "3097d51d35d1cafd"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_288_attribute_p0_sound_output_383520644241",
  "KEEP_AS_IS",
  "sound_output",
  "Minimum",
  "7611b883df561aab"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_291_attribute_p0_sound_output_393920644241",
  "REPLACE_WITH_CORRECT_FACT",
  "sound_output",
  "Minimum",
  "8866fdf8902f217c"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_187_attribute_p7_temperature_range",
  "KEEP_AS_IS",
  "temperature_range",
  "Between",
  "fd9da0d4ea6a689c"
 ],
 [
  "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_244_attribute_p7_temperature_range",
  "KEEP_AS_IS",
  "temperature_range",
  "Between",
  "23e789ec5d12a3c0"
 ]
];
// requirement id -> [fingerprint of ALL its attribute row ids, review_status]
const REVIEWED_REQUIREMENTS = {
 "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_323": [
  "1274724707d9d91f",
  "Needs Review"
 ],
 "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_261": [
  "59ad642fcc59e80c",
  "Needs Review"
 ],
 "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_187": [
  "7925aa640246a3d6",
  "Pending Approval"
 ],
 "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_244": [
  "8f4e256d7d65c2fc",
  "Needs Review"
 ],
 "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_249": [
  "06d0378fe42a24bc",
  "Needs Review"
 ],
 "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_250": [
  "df7f88df4e5286ab",
  "Needs Review"
 ],
 "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_291": [
  "4e0db79d195f171e",
  "Needs Review"
 ]
};

const DELETES = [
  `${req(249)}_attribute_p0_sound_output_313520644241`,
  `${req(249)}_attribute_p0_sound_output_3520644241`,
  `${req(250)}_attribute_p0_sound_output_363520644241`,
  `${req(323)}_attribute_p0_battery_capacity_323030204148`,
  `${req(261)}_attribute_p0_candela_rating_31352f3735206364`,
  `${req(261)}_attribute_p0_candela_rating_33302f3132302063`,
];
// Value encoding = exactly what the corrected extractor emits (worker row shape:
// parsed_value / normalized_value are JSON text, units kept). Cross-checked
// against extractAttributes(requirement text) at run time.
const REPLACEMENTS = [
  { replaces: `${req(250)}_attribute_p0_sound_output_31313020644241`, newId: `${req(250)}_attribute_r1_sound_output_between_65_110_dba`, requirement: req(250), row: { name: "sound_output", operator: "Between", original_value: "65 dBA nor exceed 110 dBA", parsed_value: "[65,110]", original_unit: "dBA", normalized_value: "[65,110]", normalized_unit: "dBA", confidence: 94 } },
  { replaces: `${req(291)}_attribute_p0_sound_output_393920644241`, newId: `${req(291)}_attribute_r1_sound_output_between_89_99_dba`, requirement: req(291), row: { name: "sound_output", operator: "Between", original_value: "89 – 99 dBA", parsed_value: "[89,99]", original_unit: "dBA", normalized_value: "[89,99]", normalized_unit: "dBA", confidence: 94 } },
  { replaces: `${req(187)}_attribute_p0_humidity_range_393525`, newId: `${req(187)}_attribute_r1_humidity_range_maximum_95_pct`, requirement: req(187), row: { name: "humidity_range", operator: "Maximum", original_value: "Humidity: Up to 95%", parsed_value: "null", original_unit: "%", normalized_value: "\"95%\"", normalized_unit: "%", confidence: 94 } },
  { replaces: `${req(244)}_attribute_p0_humidity_range_393525`, newId: `${req(244)}_attribute_r1_humidity_range_maximum_95_pct`, requirement: req(244), row: { name: "humidity_range", operator: "Maximum", original_value: "up to 95% relative humidity", parsed_value: "null", original_unit: "%", normalized_value: "\"95%\"", normalized_unit: "%", confidence: 94 } },
];
const AFFECTED_REQUIREMENTS = [249, 250, 291, 323, 261, 187, 244].map(req);

const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const fp = (value) => sha(value).slice(0, 16);
const fail = (code, detail) => { const error = new Error(`${code}: ${detail}`); error.code = code; throw error; };
const drift = (detail) => fail("R1_DATA_REPAIR_DRIFT", detail);

const db = new DatabaseSync(dbPath, { readOnly: !apply });
db.exec("PRAGMA busy_timeout = 15000");
if (apply) db.exec("PRAGMA foreign_keys = ON");
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

const verifyReviewedState = () => {
  const problems = [];
  for (const [id, action, name, operator, expected] of REVIEWED_ROWS) {
    const row = one("SELECT * FROM requirement_attributes WHERE id = ?", id);
    if (!row) { problems.push(`${id}: missing`); continue; }
    if (fp({ ...row }) !== expected) problems.push(`${id}: fingerprint differs (${name}/${operator}, action ${action})`);
  }
  for (const [requirementId, [expected, status]] of Object.entries(REVIEWED_REQUIREMENTS)) {
    const ids = all("SELECT id FROM requirement_attributes WHERE requirement_id = ? ORDER BY id", requirementId);
    if (fp(ids) !== expected) problems.push(`${requirementId}: attribute id set changed`);
    if (one("SELECT review_status s FROM technical_requirements WHERE id = ?", requirementId)?.s !== status) problems.push(`${requirementId}: review_status changed`);
  }
  for (const replacement of REPLACEMENTS) if (one("SELECT id FROM requirement_attributes WHERE id = ?", replacement.newId)) problems.push(`${replacement.newId}: already exists (repair already applied?)`);
  if (one("SELECT COUNT(*) n FROM engineering_knowledge_decisions WHERE reason = ?", REASON).n > 0) problems.push("R1 decision records already exist");
  return problems;
};

// Snapshot of everything the repair must NOT change.
const snapshot = () => {
  const affected = AFFECTED_REQUIREMENTS.map((id) => `'${id}'`).join(",");
  const golden = req(197);
  return {
    technical_requirements: fp(all("SELECT id, review_status, approved_for_downstream, requirement_type, requirement_category FROM technical_requirements ORDER BY id")),
    requirement_status_counts: all("SELECT review_status s, COUNT(*) n FROM technical_requirements GROUP BY 1 ORDER BY 1"),
    boq_requirement_links: fp(all("SELECT id, status, superseded_at FROM boq_requirement_links ORDER BY id")),
    requirement_profile_versions: fp(all("SELECT id, version_number, status, approved_for_matching FROM requirement_profile_versions ORDER BY id")),
    product_match_runs: fp(all("SELECT id, status FROM product_match_runs ORDER BY id")),
    product_match_candidates: one("SELECT COUNT(*) n FROM product_match_candidates").n,
    library_products: fp(all("SELECT id, updated_at, review_status FROM library_products ORDER BY id")),
    product_attributes: fp(all("SELECT id, superseded_at, deleted_at FROM product_attributes ORDER BY id")),
    requirement_compatibility: fp(all("SELECT id FROM requirement_compatibility ORDER BY id")),
    requirement_standards: one("SELECT COUNT(*) n FROM requirement_standards").n,
    engineering_taxonomy_terms: one("SELECT COUNT(*) n FROM engineering_taxonomy_terms").n,
    golden_197_attributes: fp(all("SELECT * FROM requirement_attributes WHERE requirement_id = ? ORDER BY id", golden)),
    golden_197_requirement: fp(one("SELECT id, review_status, approved_for_downstream, original_text FROM technical_requirements WHERE id = ?", golden)),
    attributes_outside_affected_requirements: fp(all(`SELECT * FROM requirement_attributes WHERE requirement_id NOT IN (${affected}) ORDER BY id`)),
    requirement_attributes_total: one("SELECT COUNT(*) n FROM requirement_attributes").n,
    decisions_total: one("SELECT COUNT(*) n FROM engineering_knowledge_decisions").n,
  };
};

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const report = { mode, repairVersion: REPAIR_VERSION };

const preProblems = verifyReviewedState();
if (preProblems.length) { console.error(`R1_DATA_REPAIR_DRIFT\n - ${preProblems.join("\n - ")}`); process.exit(3); }
console.log(`PRE-APPLY VERIFY OK: ${REVIEWED_ROWS.length} reviewed rows fingerprint-identical; ${Object.keys(REVIEWED_REQUIREMENTS).length} requirements unchanged (attribute id sets, review_status); no R1 rows or decisions exist yet.`);
if (!apply) { console.log("Verify only: no write."); db.close(); process.exit(0); }

// ---- backup proof ---------------------------------------------------------------
{
  const size = statSync(backupPath).size;
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  const quick = backup.prepare("PRAGMA quick_check").get();
  const backupCounts = { attributes: backup.prepare("SELECT COUNT(*) n FROM requirement_attributes").get().n, decisions: backup.prepare("SELECT COUNT(*) n FROM engineering_knowledge_decisions").get().n };
  for (const [id, , , , expected] of REVIEWED_ROWS) {
    const row = backup.prepare("SELECT * FROM requirement_attributes WHERE id = ?").get(id);
    if (!row || fp({ ...row }) !== expected) fail("R1_BACKUP_INVALID", `backup row ${id} does not match the reviewed state`);
  }
  backup.close();
  const live = { attributes: one("SELECT COUNT(*) n FROM requirement_attributes").n, decisions: one("SELECT COUNT(*) n FROM engineering_knowledge_decisions").n };
  if (Object.values(quick)[0] !== "ok" || backupCounts.attributes !== live.attributes || backupCounts.decisions !== live.decisions) fail("R1_BACKUP_INVALID", `quick_check=${Object.values(quick)[0]} counts backup=${JSON.stringify(backupCounts)} live=${JSON.stringify(live)}`);
  report.backup = { path: backupPath, bytes: size, sha256: sha256File(backupPath), quick_check: "ok", counts: backupCounts };
  console.log(`BACKUP VERIFIED: ${backupPath} (${size} bytes, sha256 ${report.backup.sha256.slice(0, 16)}…, quick_check ok, counts match live, reviewed rows identical)`);
}

const before = snapshot();
const timestamp = new Date().toISOString();
const rowById = (id) => one("SELECT * FROM requirement_attributes WHERE id = ?", id);

// ---- prepare replacement rows and cross-check against the corrected extractor -------
const inserts = REPLACEMENTS.map((replacement) => {
  const original = rowById(replacement.replaces);
  const requirement = one("SELECT original_text, project_id FROM technical_requirements WHERE id = ?", replacement.requirement);
  const expected = replacement.row;
  const emitted = extractAttributes(requirement.original_text).filter((fact) => fact.name === expected.name && fact.operator === expected.operator);
  const match = emitted.find((fact) => fact.originalValue === expected.original_value
    && JSON.stringify(fact.parsedValue) === expected.parsed_value && fact.originalUnit === expected.original_unit
    && JSON.stringify(fact.normalizedValue) === expected.normalized_value && fact.normalizedUnit === expected.normalized_unit
    && fact.confidence === expected.confidence);
  if (!match) fail("R1_ENCODING_MISMATCH", `${replacement.newId}: corrected extractor does not emit the reviewed row (${JSON.stringify(emitted)})`);
  return { ...replacement, source_location: original.source_location, requirement_id: original.requirement_id };
});

const beforeByRequirement = Object.fromEntries(AFFECTED_REQUIREMENTS.map((requirementId) => [requirementId, all("SELECT * FROM requirement_attributes WHERE requirement_id = ? AND (name IN ('sound_output','candela_rating','humidity_range','battery_capacity','battery_autonomy')) ORDER BY id", requirementId).map((row) => ({ ...row }))]));

// ---- ONE transaction ------------------------------------------------------------------
let outcome;
db.exec("BEGIN IMMEDIATE");
try {
  const midProblems = verifyReviewedState();
  if (midProblems.length) drift(`changed between verify and transaction: ${midProblems.join("; ")}`);
  const removedIds = [...DELETES, ...REPLACEMENTS.map((entry) => entry.replaces)];
  let deleted = 0;
  for (const id of removedIds) { const result = db.prepare("DELETE FROM requirement_attributes WHERE id = ?").run(id); if (result.changes !== 1) fail("R1_WRITE_ASSERT", `delete ${id} changed ${result.changes} rows`); deleted += 1; }
  let inserted = 0;
  for (const entry of inserts) {
    const r = entry.row;
    const result = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(entry.newId, entry.requirement_id, r.name, r.operator, r.original_value, r.parsed_value, r.original_unit, r.normalized_value, r.normalized_unit, r.confidence, entry.source_location);
    if (result.changes !== 1) fail("R1_WRITE_ASSERT", `insert ${entry.newId} changed ${result.changes} rows`);
    inserted += 1;
  }
  // Audit records in the existing decision table: one per affected requirement.
  const decisionIds = [];
  for (const requirementId of AFFECTED_REQUIREMENTS) {
    const project = one("SELECT project_id FROM technical_requirements WHERE id = ?", requirementId).project_id;
    const beforeRows = beforeByRequirement[requirementId];
    const afterRows = all("SELECT * FROM requirement_attributes WHERE requirement_id = ? AND (name IN ('sound_output','candela_rating','humidity_range','battery_capacity','battery_autonomy')) ORDER BY id", requirementId).map((row) => ({ ...row }));
    const removed = beforeRows.filter((row) => removedIds.includes(row.id)).map((row) => row.id);
    const added = inserts.filter((entry) => entry.requirement === requirementId).map((entry) => entry.newId);
    const decisionId = `knowledgeDecision_r1p6p7_${fp(requirementId)}`;
    const evidence = { repairVersion: REPAIR_VERSION, timestamp, actor: ACTOR, removedAttributeIds: removed, insertedAttributeIds: added, sourceText: one("SELECT original_text t FROM technical_requirements WHERE id = ?", requirementId).t, reference: "Independent Closure Audit (P0-P10) -> R1_P6_P7_EXTRACTION_SEMANTICS_REPAIR_REPORT -> reviewed R1 dry-run repair plan", backup: report.backup, reversal: "restore removed rows from previous_value; delete inserted rows named in new_value" };
    const result = db.prepare("INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, reversible, decided_by, decided_role) VALUES (?, ?, 'Technical Requirement', ?, 'r1-semantic-correction', ?, ?, ?, ?, 'Project', ?, 1, ?, 'System')")
      .run(decisionId, project, requirementId, JSON.stringify({ attributes: beforeRows }), JSON.stringify({ attributes: afterRows }), REASON, JSON.stringify(evidence), project, ACTOR);
    if (result.changes !== 1) fail("R1_WRITE_ASSERT", `decision ${decisionId} not inserted`);
    decisionIds.push(decisionId);
  }

  // ---- end-state assertions (inside the transaction; failure rolls back) -------------------
  const rating = (requirementId, name) => all("SELECT * FROM requirement_attributes WHERE requirement_id = ? AND name = ?", requirementId, name);
  const assert = (condition, detail) => { if (!condition) fail("R1_END_STATE_ASSERT", detail); };
  assert(rating(req(249), "sound_output").length === 0, "req249 must carry no sound_output");
  const s250 = rating(req(250), "sound_output");
  assert(s250.length === 1 && s250[0].operator === "Between" && s250[0].normalized_value === "[65,110]" && s250[0].normalized_unit === "dBA", "req250 must carry exactly one Between [65,110] dBA");
  const s291 = rating(req(291), "sound_output");
  assert(s291.length === 1 && s291[0].operator === "Between" && s291[0].normalized_value === "[89,99]" && s291[0].normalized_unit === "dBA", "req291 must carry exactly one Between [89,99] dBA");
  assert(rating(req(323), "battery_capacity").length === 0, "req323 must carry no battery_capacity");
  assert(rating(req(261), "candela_rating").length === 0, "req261 must carry no candela_rating");
  for (const n of [187, 244]) { const h = rating(req(n), "humidity_range"); assert(h.length === 1 && h[0].operator === "Maximum" && h[0].normalized_value === "\"95%\"" && h[0].normalized_unit === "%", `req${n} must carry exactly one Maximum 95% humidity_range`); }
  for (const [id, action, , , expected] of REVIEWED_ROWS) if (action === "KEEP_AS_IS") assert(rowById(id) && fp({ ...rowById(id) }) === expected, `kept row ${id} changed`);
  assert(deleted === 10 && inserted === 4, `expected 10 physical deletes (6 pure + 4 replaced-out) and 4 inserts, got ${deleted}/${inserted}`);
  assert(one("SELECT COUNT(*) n FROM requirement_attributes").n === before.requirement_attributes_total - 10 + 4, "attribute total mismatch");
  assert(one("SELECT COUNT(*) n FROM engineering_knowledge_decisions").n === before.decisions_total + 7, "decision total mismatch");
  db.exec("COMMIT");
  outcome = { committed: true, pureDeletes: DELETES.length, replacedOut: REPLACEMENTS.length, physicalDeletes: deleted, replacementInserts: inserted, decisionRecords: decisionIds };
} catch (error) {
  try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
  console.error(`TRANSACTION ROLLED BACK -- nothing was written. ${error.message}`);
  process.exit(4);
}

const after = snapshot();
const unexpected = Object.keys(before).filter((key) => !["requirement_attributes_total", "decisions_total"].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
console.log(JSON.stringify({ outcome, deltas: { requirement_attributes: [before.requirement_attributes_total, after.requirement_attributes_total], decisions: [before.decisions_total, after.decisions_total] }, unchangedProtectedSnapshots: Object.keys(before).length - 2 - unexpected.length, unexpectedChanges: unexpected, backup: report.backup }, null, 1));
if (unexpected.length) { console.error(`UNEXPECTED CHANGE in protected snapshot: ${unexpected.join(", ")}`); process.exit(5); }
db.close();
