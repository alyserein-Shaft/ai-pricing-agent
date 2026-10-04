import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LEGACY_ROOT = join(ROOT, "drizzle");
const ACTIVE_ROOT = join(ROOT, "drizzle-active");
const MANIFEST_PATH = join(ACTIVE_ROOT, "manifest.json");

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const objectNames = (items) => items.map((item) => typeof item === "string" ? item : item.name).sort();
const assertSortedUnique = (items, label) => {
  assert.deepEqual(items, [...items].sort(), `${label} must be sorted`);
  assert.equal(new Set(items).size, items.length, `${label} must be unique`);
};

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const frozenLegacyFiles = manifest.legacyMigrations.map((entry) => entry.path);
const legacyFiles = readdirSync(LEGACY_ROOT)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const activeFiles = existsSync(ACTIVE_ROOT)
  ? readdirSync(ACTIVE_ROOT).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
  : [];
const schemaSource = readFileSync(join(ROOT, "db", "schema.ts"), "utf8");
const schemaTables = [...schemaSource.matchAll(/\bsqliteTable\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]).sort();
const baselineSql = readFileSync(join(ACTIVE_ROOT, "0000_baseline_schema_0082.sql"), "utf8");

// The active chain head is read once, at module scope, and is the single source
// of "where the chain is now". The manifest cutoff and the on-disk migration set
// are both checked AGAINST it rather than against a remembered number: pinning
// the head as a literal is what let this gate stay red while a migration was
// appended correctly. A migration that lands without moving the manifest, or a
// journal entry with no SQL file, still fails here -- which is the property the
// original literal pins were written to protect.
const activeJournal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
const activeJournalTags = activeJournal.entries.map((entry) => entry.tag);
const activeJournalFiles = activeJournalTags.map((tag) => `${tag}.sql`).sort();
const activeHeadTag = activeJournalTags[activeJournalTags.length - 1];

// The adopted baseline and its governed successors, pinned positively so that
// deleting or renaming any of them fails even though the parity check above
// would still be satisfied by a shorter chain.
const adoptedBaselineChain = [
  "0000_baseline_schema_0082",
  "0001_price_record_intake_lineage",
  "0002_governing_source_fk",
  "0003_review_decision_immutability",
  "0004_fire_alarm_panel_sizing_snapshots",
  "0005_document_revision_addendum",
  "0006_project_effective_time_calendar",
  "0007_project_calendar_evidence_repair",
  "0008_profile_applicability_source_authority",
  "0009_profile_applicability_device_identity_authority",
  "0010_requirement_intelligence_source_authority",
  "0011_requirement_intelligence_constraint_restore",
  "0012_military_havok",
  // 0013 (MVP-CLOSE-11) added the three clause-admission-outcome columns and the
  // spec_clauses_admission_status_idx index. MVP-CLOSE-11 did not add it here,
  // which left this assertion red against its own applied chain.
  "0013_specification_clause_admission_outcome",
  // 0014 (MVP-CLOSE-13) adds candidate_mechanism only: one nullable column, no
  // index, no status change and no new table.
  "0014_specification_clause_candidate_mechanism",
  // 0015 (MVP-BOM-5) rebuilds pricing_lines and project_quotation_lines to model
  // a pure SCOPE source: generalized boq/candidate/safety NULLs, a NOT NULL
  // scope identity, branch-exclusive CHECKs and two partial UNIQUE indexes.
  "0015_pricing_quotation_scope_source_model",
  // 0016 (MVP-CLOSE-16) adds specification_clause_candidate_decisions: the
  // governed review/promotion record for a REQUIREMENT_CANDIDATE. Append-only
  // with immutability triggers, three partial UNIQUE indexes that make a second
  // promotion of the same clause physically impossible, and no change to any
  // admission rule, candidate mechanism or downstream authority definition.
  "0016_specification_clause_candidate_decisions",
  // 0017 (GOLDEN-6C2) adds fire_alarm_preliminary_sizing_snapshots: project-level
  // preliminary Fire Alarm point-count evidence, mirroring 0004 minus every
  // product-identity channel. No ecosystem/device family/panel identity column
  // exists on the table, so GOLDEN-5's preliminary-point prerequisite has a
  // governed record to read without forcing a live recompute.
  "0017_fire_alarm_preliminary_sizing_snapshots",
  // 0018 (CURRENT-BOQ-AUTHORITY consolidation) is trigger-only: it drops and
  // recreates estimator_understanding_review_current_evidence_guard WITHOUT the
  // documents.current_version_id head-pointer conjunct, so the DB guard no
  // longer enforces a different definition of "current" from the DOC-R3
  // application authority. No table, column, index, or trigger is added or
  // removed, so every object count below is unchanged by design.
  "0018_understanding_review_evidence_governing_repair",
];

const objectCounts = (sql, pattern) => [...sql.matchAll(pattern)].length;
const baselineTables = objectCounts(baselineSql, /CREATE TABLE IF NOT EXISTS `([^`]+)`/g);
const baselineIndexes = objectCounts(baselineSql, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+/gi);
const baselineTriggers = objectCounts(baselineSql, /CREATE\s+TRIGGER\s+/gi);
const baselineViews = objectCounts(baselineSql, /CREATE\s+VIEW\s+/gi);

const sourceIndexes = objectNames(manifest.indexes);
const sourceTriggers = objectNames(manifest.triggers);
const sourceViews = objectNames(manifest.views);
const sourceTables = objectNames(manifest.tables);
const missingIndexes = [
  "boq_decisions_item_idx", "boq_decisions_version_idx", "boq_evidence_item_idx",
  "boq_extraction_status_idx", "boq_items_downstream_idx", "boq_revision_pair_idx",
  "boq_sections_version_idx", "boq_sources_version_idx", "boq_warnings_item_idx",
  "boq_warnings_version_idx", "classifications_status_idx", "document_audit_document_idx",
  "document_versions_document_idx", "knowledge_facts_file_idx", "knowledge_file_events_idx",
  "knowledge_files_org_name_idx", "knowledge_product_links_part_idx", "processing_document_idx",
  "processing_logs_run_idx", "product_attributes_active_protocol_singleton_idx",
  "spec_job_document_idx", "upload_sessions_project_idx",
];

const collisions = [
  "0019_identity_library_scope_isolation.sql",
  "0019_requirement_review_immutability.sql",
  "0020_applicability_decision_immutability.sql",
  "0020_identity_mutation_compare_and_swap.sql",
];

test("active manifest freezes the canonical 0084 target and complete inventory", () => {
  assert.equal(manifest.manifestVersion, 1);
  // The cutoff is the active chain head, verified against the journal rather than
  // restated: a migration appended to the chain without also advancing the
  // manifest fails this comparison, which is exactly the drift the manifest
  // exists to prevent.
  assert.deepEqual(manifest.target, {
    legacyDirectory: "drizzle",
    activeDirectory: "drizzle-active",
    cutoffMigration: `${activeHeadTag}.sql`,
  });
  // 317 business tables: the 314 canonical set plus
  // estimator_understanding_field_reviews (active 0012, R11 Phase 6),
  // specification_clause_candidate_decisions (active 0016, MVP-CLOSE-16), and
  // fire_alarm_preliminary_sizing_snapshots (active 0017, GOLDEN-6C2).
  assert.deepEqual(manifest.counts, {
    businessTables: 317,
    // 457 at the 0011 head, verified by applying the real active chain to a
    // disposable SQLite file: 456 at the 0007 head, +1 for
    // 0009's table rebuild, which drops the `profile_applicability_drawing_ref_idx`
    // partial unique index together with the old table and re-asserts uniqueness
    // under its new name, `profile_applicability_device_identity_idx`. The
    // requirement_intelligence indexes and the applicability requirement/status
    // indexes already existed in the 0000 baseline and are only re-asserted by the
    // 0008/0010/0011 rebuilds, so they contribute no net change.
    // 461 at the current head. Derivation, newest last:
    //   0012 head: 457 at the 0011 head + 3 indexes on the new field-review table = 460
    //   0013:      + spec_clauses_admission_status_idx (MVP-CLOSE-11 clause admission
    //              outcome) = 461. MVP-CLOSE-11 added that index but did NOT record it
    //              here or in manifest.json, which left this file red; MVP-CLOSE-13
    //              recorded it and advanced the count rather than pinning it back to
    //              460, which would have hidden a real index in the applied chain.
    //   0014:      + 0. MVP-CLOSE-13 adds candidate_mechanism as a column only, with
    //              no index, so the count is unchanged by design.
    //   0015:      + 2. MVP-BOM-5 adds the two generalized-source partial UNIQUEs,
    //              pricing_lines_scope_uniq and quotation_lines_scope_uniq, to the
    //              SCOPE branch of the rebuilt pricing/quotation line tables.
    //   0016:      + 6. MVP-CLOSE-16 adds three plain indexes and three partial
    //              UNIQUEs on specification_clause_candidate_decisions, which is
    //              what makes a second promotion of the same clause impossible.
    //   0017:      + 2. GOLDEN-6C2 adds the preliminary-sizing version and
    //              current indexes on fire_alarm_preliminary_sizing_snapshots,
    //              mirroring 0004's sizing indexes.
    namedIndexes: 471,
    // 45, not 41: 0006 adds the two `projects_declared_calendar_guard*`
    // triggers that make a half-declared project calendar impossible to record,
    // 0016 adds the two candidate-decision immutability triggers, and 0017 adds
    // the two preliminary-sizing immutability triggers (GOLDEN-6C2).
    // They are counted here because the manifest is the *target object* inventory
    // of the active chain, not a historical ledger, and a trigger that exists in
    // the chain but not in the manifest would make the disposable-database
    // verifier report it as an extra object.
    triggers: 47,
    views: 2,
  });
  assertSortedUnique(sourceTables, "manifest tables");
  assertSortedUnique(sourceIndexes, "manifest indexes");
  assertSortedUnique(sourceTriggers, "manifest triggers");
  assertSortedUnique(sourceViews, "manifest views");
  assert.equal(sourceTables.length, 317);
  // 471, matching `counts.namedIndexes` above and the real chain head. Kept as an
  // absolute number on purpose: the manifest-vs-count comparison alone cannot see
  // an object that is dropped from the manifest and from the count together.
  // See the derivation above: 461 at the 0014 head, +2 for MVP-BOM-5's 0015
  // (pricing_lines_scope_uniq, quotation_lines_scope_uniq), +6 for MVP-CLOSE-16's
  // 0016 candidate-decision indexes, +2 for GOLDEN-6C2's 0017 preliminary-sizing
  // indexes.
  assert.equal(sourceIndexes.length, 471);
  // 47: the 43 recorded before 0016, plus the two
  // specification_clause_candidate_decisions_immutable_* triggers and the two
  // fire_alarm_preliminary_sizing_snapshots_immutable_* triggers. A decision is
  // a historical fact, so it is append-only at the database level.
  assert.equal(sourceTriggers.length, 47);
  assert.equal(sourceViews.length, 2);
  assert.deepEqual(sourceViews, ["canonical_classifications", "canonical_library_products"]);
  assert.ok(sourceTriggers.includes("quotation_revision_payload_update_guard"));
  assert.ok(sourceTriggers.includes("projects_declared_calendar_guard"));
  assert.ok(sourceTriggers.includes("projects_declared_calendar_guard_update"));
  assert.ok(
    sourceTriggers.filter((name) => name.startsWith("projects_declared_calendar_guard")).every(
      (name) => manifest.triggers.find((entry) => entry.name === name).source === "drizzle-active/0006_project_effective_time_calendar.sql",
    ),
    "the project-calendar guards must be attributed to the migration that creates them",
  );
  assert.deepEqual(missingIndexes.filter((name) => !sourceIndexes.includes(name)), []);
  for (const entry of [...manifest.tables, ...manifest.indexes, ...manifest.triggers, ...manifest.views]) {
    assert.ok(existsSync(join(ROOT, entry.source)), `manifest source path must exist: ${entry.source}`);
  }
});

test("db/schema.ts covers every canonical business table without phantoms", () => {
  // 317: 0016 (MVP-CLOSE-16) adds specification_clause_candidate_decisions and
  // 0017 (GOLDEN-6C2) adds fire_alarm_preliminary_sizing_snapshots.
  assert.equal(schemaTables.length, 317);
  assert.equal(new Set(schemaTables).size, 317);
  const target = new Set(sourceTables);
  const declared = new Set(schemaTables);
  assert.deepEqual([...target].filter((name) => !declared.has(name)).sort(), []);
  assert.deepEqual([...declared].filter((name) => !target.has(name)).sort(), []);
  for (const name of ["project_quotation_lines", "estimator_understanding_review_versions", "project_npq_profile_versions", "supplier_quote_intake_rows"]) {
    assert.ok(schemaTables.includes(name), `schema.ts must contain ${name}`);
  }
});

test("active baseline SQL contains the complete source object set", () => {
  assert.equal(baselineTables, 311);
  assert.equal(baselineIndexes, 442);
  assert.equal(baselineTriggers, 30);
  assert.equal(baselineViews, 2);
  for (const name of [
    "boq_revision_pair_idx",
    "product_attributes_active_protocol_singleton_idx",
    "quotation_revision_payload_update_guard",
    "canonical_library_products",
    "canonical_classifications",
  ]) assert.ok(baselineSql.includes(name), `baseline must contain ${name}`);
  assert.doesNotMatch(baselineSql, /^\s*(?:INSERT|UPDATE|DELETE)\s+/im);
});

test("legacy migrations remain byte-preserved and excluded from active chain", () => {
  assert.equal(manifest.legacyMigrations.length, 85);
  assert.deepEqual(frozenLegacyFiles, manifest.legacyMigrations.map((entry) => entry.path));
  assert.deepEqual(frozenLegacyFiles, frozenLegacyFiles.filter((name) => Number(name.slice(0, 4)) <= 82));
  assert.deepEqual(frozenLegacyFiles.filter((name) => Number(name.slice(0, 4)) > 82), []);
  assert.ok(legacyFiles.filter((name) => Number(name.slice(0, 4)) > 82).every((name) => !frozenLegacyFiles.includes(name)));
  for (const entry of manifest.legacyMigrations) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(join(LEGACY_ROOT, entry.path)), entry.sha256);
  }
  for (const name of collisions) {
    assert.ok(legacyFiles.includes(name));
    assert.equal(activeFiles.includes(name), false);
  }
  assert.ok(activeFiles.includes("0000_baseline_schema_0082.sql"));
  assert.ok(activeFiles.includes("0003_review_decision_immutability.sql"));
  assert.ok(activeFiles.includes("0004_fire_alarm_panel_sizing_snapshots.sql"));
  assert.ok(activeFiles.includes("0005_document_revision_addendum.sql"));
  // 0006 is the reconciled successor of the previous cutoff, so its presence is
  // asserted positively rather than merely tolerated: a future migration entering
  // without moving the cutoff, the manifest counts and the manifest object list
  // would leave the disposable-database verifier reporting it as an extra object.
  assert.ok(activeFiles.includes("0006_project_effective_time_calendar.sql"));
  // 0007 is the CHECK-A evidence repair for 0006's original blanket backfill:
  // same positive-assertion protocol as 0006 (presence + cutoff + manifest),
  // because a repair migration entering without moving them would leave the
  // disposable-database verifier reporting it as an extra object.
  assert.ok(activeFiles.includes("0007_project_calendar_evidence_repair.sql"));
  // The 0008-0011 authority migrations are asserted positively for the same
  // reason. This assertion previously read `assert.deepEqual(activeFiles.filter(
  // (name) => name.startsWith("0008_")), [])` -- a guard written when 0008 was the
  // *next* number. It was never widened as the chain advanced, so it went on
  // asserting the absence of migrations that had long since been applied, and
  // reported red against a chain that was correct.
  for (const tag of adoptedBaselineChain.filter((name) => Number(name.slice(0, 4)) >= 8)) {
    assert.ok(activeFiles.includes(`${tag}.sql`), `${tag}.sql must be present in the active chain`);
  }
  // The self-maintaining replacement for that literal: the journal and the
  // on-disk SQL set must be the same set, in both directions. A migration added
  // to disk without a journal entry, a journal entry with no SQL file, and a
  // legacy collision number re-entering the active chain all fail here.
  assert.deepEqual(activeJournalFiles, activeFiles, "the active chain files and the Drizzle journal must be the same set");
  assert.deepEqual(activeFiles.filter((name) => /^0019_|^0020_/.test(name)), []);
  // Manifest objects adopted by the 0000 baseline legitimately cite the frozen
  // legacy chain, which is historical evidence and must never be replayed. Their
  // existence at the declared path is asserted in the manifest test above; what is
  // asserted here is only that no manifest object cites a legacy file ABOVE the
  // 0082 adoption cutoff, because those are not part of the frozen evidence set
  // and the manifest would then be citing a migration that adoption never read.
  for (const entry of [...manifest.tables, ...manifest.indexes, ...manifest.triggers, ...manifest.views]) {
    if (!entry.source.startsWith("drizzle/")) continue;
    const cited = entry.source.replace(/^drizzle\//, "");
    assert.ok(frozenLegacyFiles.includes(cited), `manifest object ${entry.name} cites a legacy migration above the 0082 cutoff: ${entry.source}`);
  }
});

test("active 0005 integrates legacy document revision dependencies without suppressing supersession writes", () => {
  const sql = readFileSync(join(ACTIVE_ROOT, "0005_document_revision_addendum.sql"), "utf8");
  for (const object of [
    "ALTER TABLE `document_versions` ADD COLUMN `effective_from`",
    "ALTER TABLE `document_versions` ADD COLUMN `effective_to`",
    "ALTER TABLE `documents` ADD COLUMN `document_family_id`",
    "CREATE TABLE `document_families`",
    "CREATE TABLE `document_supersessions`",
    "document_supersessions_superseding_idx",
    "document_supersessions_superseded_idx",
    "document_supersessions_scope_idx",
    "documents_family_idx",
  ]) assert.ok(sql.includes(object), `0005 must integrate ${object}`);

  // The one data write this migration is allowed to make is the self-family
  // link on the column it just introduced. It must be exactly that statement,
  // and nothing in the active chain may delete or truncate a row.
  assert.doesNotMatch(sql, /^\s*(?:DELETE|TRUNCATE)\s+/im, "an additive revision migration must never delete evidence");
  const familyLink = sql.match(/^UPDATE\s+`documents`\s+SET\s+`document_family_id`\s*=\s*'docfam_'\s*\|\|\s*`id`\s+WHERE\s+`document_family_id`\s+IS\s+NULL;$/im);
  assert.ok(familyLink, "0005 must link every pre-existing document to exactly one derived self-family");
  const allUpdates = sql.match(/^\s*UPDATE\s+/gim) ?? [];
  assert.equal(allUpdates.length, 1, "0005 may run exactly one UPDATE, and only the self-family link");
  assert.doesNotMatch(sql, /^\s*UPDATE\s+(?!`documents`\s+SET\s+`document_family_id`)/im, "0005 must not update any other table or column");
  const documentVersions = manifest.tables.find((table) => table.name === "document_versions");
  const documents = manifest.tables.find((table) => table.name === "documents");
  assert.ok(documentVersions.columns.some((column) => column.name === "effective_from"));
  assert.ok(documentVersions.columns.some((column) => column.name === "effective_to"));
  assert.ok(documents.columns.some((column) => column.name === "document_family_id"));
  assert.ok(manifest.tables.some((table) => table.name === "document_supersessions"));
});

test("active Drizzle metadata is a fresh baseline plus governed authority migrations", () => {
  const journal = activeJournal;
  // The snapshot compared against the manifest is the one belonging to the LAST
  // journal entry, not a hard-coded file. Pinning a filename here meant that every
  // appended migration silently left this assertion comparing the manifest against
  // a stale schema, which is precisely how a column could be added to the chain and
  // to the manifest while the metadata gate still reported agreement.
  const lastTag = journal.entries[journal.entries.length - 1].tag;
  const snapshotIndex = lastTag.slice(0, 4);
  const snapshot = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", `${snapshotIndex}_snapshot.json`), "utf8"));
  assert.equal(journal.version, "7");
  assert.equal(journal.dialect, "sqlite");
  assert.deepEqual(journal.entries.map((entry) => entry.tag), adoptedBaselineChain);
  // Order is authority: the journal is the apply order, so the adopted baseline
  // must remain the prefix and the governed successors must follow it in the
  // sequence they were applied. A reordered or silently dropped entry fails
  // here, and the journal/disk parity asserted in the previous test fails too.
  assert.deepEqual(journal.entries.map((entry) => entry.idx), adoptedBaselineChain.map((_, index) => index));
  assert.deepEqual(journal.entries.slice(0, 8).map((entry) => entry.tag), adoptedBaselineChain.slice(0, 8));
  // One snapshot per journal entry, and the last entry's snapshot is the one the
  // manifest is compared against below.
  const snapshotFiles = readdirSync(join(ACTIVE_ROOT, "meta")).filter((name) => /^\d{4}_snapshot\.json$/.test(name)).sort();
  assert.deepEqual(snapshotFiles, journal.entries.map((entry) => `${entry.tag.slice(0, 4)}_snapshot.json`));
  assert.notEqual(snapshot.prevId, "00000000-0000-0000-0000-000000000000");
  assert.equal(Object.keys(snapshot.tables || {}).length, 317); // 0017 head adds fire_alarm_preliminary_sizing_snapshots (GOLDEN-6C2); 0018 is trigger-only, table count unchanged
  const sourceTables = new Map(manifest.tables.map((table) => [table.name, table.columns.map((column) => column.name).sort()]));
  for (const [name, sourceColumns] of sourceTables) {
    const actualColumns = Object.values(snapshot.tables[name].columns || {}).map((column) => column.name).sort();
    assert.deepEqual(actualColumns, sourceColumns, `${name} columns must match the canonical source manifest`);
  }
  for (const name of ["excel_export_jobs", "supplier_quote_lines", "specification_extraction_jobs", "project_quotation_lines"]) {
    assert.ok(Object.keys(snapshot.tables[name].foreignKeys || {}).length > 0, `${name} must retain canonical foreign keys`);
  }
});

test("all active migration consumers use drizzle-active", () => {
  const config = readFileSync(join(ROOT, "drizzle.config.ts"), "utf8");
  const wrangler = readFileSync(join(ROOT, "tests/e2e/wrangler.golden.jsonc"), "utf8");
  const buildPlugin = readFileSync(join(ROOT, "build/sites-vite-plugin.ts"), "utf8");
  assert.match(config, /out:\s*["']\.\/drizzle-active["']/);
  assert.match(config, /schema:\s*["']\.\/db\/schema\.ts["']/);
  assert.match(wrangler, /["']migrations_dir["']\s*:\s*["']\.\.\/\.\.\/drizzle-active["']/);
  assert.match(buildPlugin, /resolve\(root, ["']drizzle-active["']\)/);
});

test("legacy 0080 direct-apply path is explicitly non-authoritative", () => {
  const source = readFileSync(join(ROOT, "scripts", "apply-0080-onboarding-d-contact-title.mjs"), "utf8");
  assert.match(source, /ALLOW_LEGACY_OUT_OF_BAND_0080/);
  assert.match(source, /LEGACY_0080_APPLY_DISABLED/);
  assert.match(source, /drizzle-active/);
});

test("the focused baseline test contains no database or command execution", () => {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:(?:sqlite|child_process)["']/);
  assert.doesNotMatch(source, /\bnew\s+DatabaseSync\s*\(/);
  assert.doesNotMatch(source, /\b(?:execFileSync|spawnSync|spawn|exec)\s*\(/);
});
