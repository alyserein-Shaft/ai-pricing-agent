/**
 * R9 -- specification extraction reaches a real terminal state.
 *
 * The read-purity suite proves that a GET dispatches no work and that the
 * explicit resume/retry commands dispatch. This suite closes the remaining
 * half: that the dispatched work actually executes, survives a first-attempt
 * failure, terminates in a governed status, persists its evidence, and never
 * re-executes or duplicates what it already committed.
 *
 * It runs against the real active migration chain and the real extractor. No
 * Golden fixture, gate, or evidence artifact is read or written here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { processSpecificationJob, retrySpecificationChunk } from "../worker/specification-extraction-background.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      // D1 reports write results as { meta: { changes } }; node:sqlite reports
      // them flat. The governed code reads the D1 shape, so expose both.
      run: async () => {
        const result = raw.prepare(sql).run(...args);
        return { ...result, meta: { changes: Number(result.changes || 0), last_insert_rowid: result.lastInsertRowid } };
      },
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  batch: async (statements) => {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

/** Builds the authoritative database from the ordered active migration chain. */
const activeDatabase = async () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of migrations) {
    const sql = await readFile(`${directory}${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return { raw, chain: migrations };
};

const SPECIFICATION_TEXT = [
  "FIRE ALARM SPECIFICATION",
  "SECTION 011000 - SUMMARY",
  "The fire alarm control panel shall be an addressable fire alarm control panel.",
  "1.1 General",
  "The system shall provide a minimum of 500 addressable devices per control panel.",
  "2. Devices",
  "Each addressable smoke detector shall be approved to EN 54-20.",
].join("\n");

/**
 * One governed project, document, stored version, processing run, extraction
 * version, job and single queued chunk. Nothing here is invented by the test:
 * the rows are the minimum the governed write path requires, and the job is
 * dispatched exactly as the API dispatches it.
 */
const seedGovernedJob = (raw, { id = "job-1", extension = "txt", filename = "specification.txt" } = {}) => {
  const now = new Date().toISOString();
  const bytes = Buffer.from(SPECIFICATION_TEXT, "utf8");
  raw.exec(`
    INSERT INTO projects (id,name,owner_user_id,system_domain) VALUES ('project-1','Terminal Execution Project','user-1','Fire Alarm');
    INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by,current_version_id)
      VALUES ('document-1','project-1','Fire Alarm Specification','Technical Specification','Manual','user-1','version-1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('version-1','document-1',1,'${filename}','stored.${extension}','${extension}','text/plain',${bytes.length},'sha-1','sources/version-1','user-1');
    INSERT INTO document_processing_runs (id,document_version_id,stage,status,progress,attempt,max_attempts,cancel_requested,processor_version,started_at,created_at,updated_at)
      VALUES ('run-1','version-1','Specification Extraction','Pending',0,0,3,0,'spec-test','${now}','${now}','${now}');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,processing_run_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,started_at,created_by)
      VALUES ('extraction-1','document-1','version-1','run-1',1,'Running','p','r','m','pr','o','${now}','user-1');
    INSERT INTO specification_extraction_jobs (id,extraction_version_id,document_id,document_version_id,project_id,status,total_pages,processed_pages,completed_chunks,remaining_chunks,chunk_size,extracted_clauses,extracted_requirements,elapsed_seconds,worker_version,source_fingerprint,resume_token,scope_mode,project_system,requested_by,started_at,created_at)
      VALUES ('${id}','extraction-1','document-1','version-1','project-1','Running',1,0,0,1,1,0,0,0,'spec-test','source-fingerprint','resume-token','Full Document','Fire Alarm','user-1','${now}','${now}');
    INSERT INTO specification_extraction_chunks (id,job_id,chunk_number,page_from,page_to,page_count,priority,relevance,status,attempt,max_attempts,input_fingerprint,updated_at)
      VALUES ('${id}_chunk_1','${id}',1,1,1,1,0,'Full Document','Queued',0,2,'input-fingerprint','${now}');
  `);
  return bytes;
};

const files = (bytes) => ({
  get: async () => (bytes ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null),
});

const count = (raw, table, where = "") => Number(raw.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get().count);

test("R9 a dispatched specification job executes, survives a first-attempt failure, and terminates in a governed status", async () => {
  const { raw, chain } = await activeDatabase();
  assert.ok(chain.length >= 5, "the active chain must include the R8/R7 authority migrations");
  const bytes = seedGovernedJob(raw);
  const env = { DB: d1(raw), FILES: files(null) };

  // First execution: the stored object is not readable, so the chunk must fail
  // visibly and stay retryable instead of silently completing.
  const first = await processSpecificationJob(env, { jobId: "job-1" });
  assert.equal(first.terminal, false, "a failed chunk is not a terminal job");
  const afterFailure = raw.prepare("SELECT status,attempt,error_code FROM specification_extraction_chunks WHERE id='job-1_chunk_1'").get();
  assert.equal(afterFailure.status, "Retrying");
  assert.equal(afterFailure.attempt, 1);
  assert.equal(afterFailure.error_code, "STORAGE_OBJECT_MISSING");
  assert.equal(count(raw, "specification_extraction_failures", "WHERE retryable=1"), 1, "the failure is recorded as retryable");
  assert.equal(count(raw, "specification_chunk_entities"), 0, "a failed attempt commits no extracted entity");
  assert.equal(count(raw, "technical_requirements"), 0, "a failed attempt never reaches the requirement authority");

  // The retry must really execute, not merely be dispatched.
  env.FILES = files(bytes);
  const retried = await processSpecificationJob(env, { jobId: "job-1" });
  assert.equal(retried.terminal, true, "the retried job reaches a terminal state");
  const job = raw.prepare("SELECT status,processed_pages,completed_chunks,remaining_chunks,failed_at,completed_at FROM specification_extraction_jobs WHERE id='job-1'").get();
  assert.equal(job.status, "Completed");
  assert.equal(job.remaining_chunks, 0);
  assert.equal(job.completed_chunks, 1);
  assert.equal(job.processed_pages, 1);
  assert.ok(job.completed_at, "a completed job records its completion time");
  assert.equal(job.failed_at, null, "a job that ultimately completes is not marked failed");
  const chunk = raw.prepare("SELECT status,attempt,error_code,clause_count,output_fingerprint FROM specification_extraction_chunks WHERE id='job-1_chunk_1'").get();
  assert.equal(chunk.status, "Completed");
  assert.equal(chunk.attempt, 2, "the retry is a real second execution");
  assert.equal(chunk.error_code, null, "the terminal chunk carries no error");
  assert.ok(chunk.output_fingerprint, "the executed chunk records its output fingerprint");

  // The extraction is evidence, not a status flip.
  assert.ok(count(raw, "specification_extraction_pages") >= 1, "the executed page is persisted");
  assert.ok(count(raw, "specification_chunk_entities") >= 1, "the executed entities are persisted");
  assert.ok(count(raw, "technical_requirements") >= 1, "the executed requirements reach the requirement authority for review");
  assert.equal(count(raw, "specification_chunk_metrics"), 1, "exactly one metric row per executed chunk");
  assert.equal(count(raw, "specification_extraction_failures"), 1, "the failed attempt stays in history next to the successful retry");
  assert.equal(raw.prepare("SELECT status FROM document_processing_runs WHERE id='run-1'").get().status, "Completed", "the processing run reaches the same terminal status");
  assert.equal(raw.prepare("SELECT status FROM specification_extraction_versions WHERE id='extraction-1'").get().status, "Completed");
  assert.equal(count(raw, "processing_history", "WHERE run_id='run-1' AND to_status='Completed'"), 1, "the terminal transition is recorded once");
  raw.close();
});

test("R9 a failed rerun does not supersede the last successful specification extraction", async () => {
  const { raw } = await activeDatabase();
  seedGovernedJob(raw);
  raw.prepare(`
    INSERT INTO specification_extraction_versions
      (id,document_id,document_version_id,processing_run_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,started_at,created_by)
    VALUES ('extraction-0','document-1','version-1','run-1',0,'Completed','p','r','m','pr','o',datetime('now'),'user-1')
  `).run();
  raw.prepare("UPDATE specification_extraction_chunks SET max_attempts=0 WHERE id='job-1_chunk_1'").run();
  const env = { DB: d1(raw), FILES: files(null) };

  const result = await processSpecificationJob(env, { jobId: "job-1" });
  assert.equal(result.terminal, true);
  assert.equal(raw.prepare("SELECT status FROM specification_extraction_versions WHERE id='extraction-1'").get().status, "Failed");
  assert.equal(raw.prepare("SELECT superseded_at FROM specification_extraction_versions WHERE id='extraction-0'").get().superseded_at, null);
  raw.close();
});

test("R9 a terminal specification job is never re-executed and never duplicates persisted evidence", async () => {
  const { raw } = await activeDatabase();
  const bytes = seedGovernedJob(raw);
  const env = { DB: d1(raw), FILES: files(bytes) };

  await processSpecificationJob(env, { jobId: "job-1" });
  const baseline = {
    entities: count(raw, "specification_chunk_entities"),
    requirements: count(raw, "technical_requirements"),
    pages: count(raw, "specification_extraction_pages"),
    map: count(raw, "specification_document_map_entries"),
    metrics: count(raw, "specification_chunk_metrics"),
    history: count(raw, "processing_history"),
    checkpoints: count(raw, "specification_extraction_checkpoints"),
  };
  assert.equal(raw.prepare("SELECT status FROM specification_extraction_jobs WHERE id='job-1'").get().status, "Completed");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repeat = await processSpecificationJob(env, { jobId: "job-1" });
    assert.equal(repeat.terminal, true, "a terminal job reports terminal without work");
  }

  assert.equal(count(raw, "specification_chunk_entities"), baseline.entities, "no entity is duplicated");
  assert.equal(count(raw, "technical_requirements"), baseline.requirements, "no requirement is duplicated");
  assert.equal(count(raw, "specification_extraction_pages"), baseline.pages, "no page is duplicated");
  assert.equal(count(raw, "specification_document_map_entries"), baseline.map, "the document map is not rebuilt");
  assert.equal(count(raw, "specification_chunk_metrics"), baseline.metrics, "no metric row is duplicated");
  assert.equal(count(raw, "processing_history"), baseline.history, "no extra terminal transition is recorded");
  assert.equal(count(raw, "specification_extraction_checkpoints"), baseline.checkpoints, "a terminal job writes no further checkpoint");
  raw.close();
});

test("R9 an explicit chunk retry is refused for a chunk that is not in a retryable state", async () => {
  const { raw } = await activeDatabase();
  const bytes = seedGovernedJob(raw);
  const env = { DB: d1(raw), FILES: files(bytes) };
  await processSpecificationJob(env, { jobId: "job-1" });

  const refused = await retrySpecificationChunk(env.DB, "job-1", "job-1_chunk_1");
  assert.equal(refused, false, "a completed chunk cannot be re-armed by the retry command");
  assert.equal(raw.prepare("SELECT status FROM specification_extraction_chunks WHERE id='job-1_chunk_1'").get().status, "Completed");
  assert.equal(raw.prepare("SELECT status FROM specification_extraction_jobs WHERE id='job-1'").get().status, "Completed", "a refused retry cannot reopen a completed job");
  raw.close();
});

test("R9 the active chain used by this proof carries the governed review and panel protections", async () => {
  const { raw, chain } = await activeDatabase();
  assert.ok(chain.includes("0003_review_decision_immutability.sql"), "the R8 immutability migration is in the chain");
  assert.ok(chain.includes("0004_fire_alarm_panel_sizing_snapshots.sql"), "the R7 snapshot migration is in the chain");
  const protections = raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('review_decisions_immutable_update','review_decisions_immutable_delete','review_decisions_version_cas_guard','review_audit_log_immutable_update','review_audit_log_immutable_delete','fire_alarm_panel_sizing_snapshots_immutable_update','fire_alarm_panel_sizing_snapshots_immutable_delete') ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(protections, [
    "fire_alarm_panel_sizing_snapshots_immutable_delete",
    "fire_alarm_panel_sizing_snapshots_immutable_update",
    "review_audit_log_immutable_delete",
    "review_audit_log_immutable_update",
    "review_decisions_immutable_delete",
    "review_decisions_immutable_update",
    "review_decisions_version_cas_guard",
  ]);
  assert.equal(integrityCheck(raw), "ok");
  raw.close();
});

function integrityCheck(raw) {
  return raw.prepare("PRAGMA integrity_check").get().integrity_check;
}
