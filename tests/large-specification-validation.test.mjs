import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createSpecificationJob, processSpecificationJob, retrySpecificationChunk } from "../worker/specification-extraction-background.mjs";
import { handleSpecificationExtractionApi } from "../worker/specification-extraction-api.mjs";

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  run() { const result = this.db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes || 0), last_row_id: result.lastInsertRowid } }; }
  first() { return this.db.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
}

class D1Fixture {
  constructor(path) { this.sqlite = new DatabaseSync(path); }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const output = statements.map((statement) => statement.run()); this.sqlite.exec("COMMIT"); return output; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}

const request = (documentId, action) => new Request(`http://localhost/api/documents/${documentId}/specification-extraction/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

test("Hotel 2340-page specification survives lifecycle, recovery, isolated retry, and concurrency", { timeout: 240_000 }, async (context) => {
  const dbPath = process.env.QA_LARGE_SPEC_DB;
  const pdfPath = process.env.QA_LARGE_SPEC_PDF;
  if (!dbPath || !pdfPath) return context.skip("Set QA_LARGE_SPEC_DB and QA_LARGE_SPEC_PDF for the real Hotel workload validation.");
  const DB = new D1Fixture(dbPath);
  const bytes = new Uint8Array(await readFile(pdfPath));
  let storageAvailable = true;
  const queued = [];
  const env = {
    DB,
    FILES: {
      head: async () => storageAvailable ? { size: bytes.byteLength } : null,
      get: async (_key, options = {}) => {
        if (!storageAvailable) return null;
        const offset = Number(options.range?.offset || 0);
        const length = Number(options.range?.length || bytes.byteLength);
        const selected = options.range ? bytes.slice(offset, Math.min(bytes.byteLength, offset + length)) : bytes.slice();
        return { arrayBuffer: async () => selected.buffer.slice(selected.byteOffset, selected.byteOffset + selected.byteLength) };
      },
    },
    SPECIFICATION_QUEUE: { send: async (message) => { queued.push(message); } },
  };
  const ctx = { waitUntil() {} };
  try {
    const document = DB.prepare("SELECT d.id,p.owner_user_id FROM documents d JOIN projects p ON p.id=d.project_id JOIN document_versions v ON v.id=d.current_version_id WHERE v.original_filename='COMPILED SPECIFICATIONS - LA PORTA AL AKARIA.pdf'").first();
    assert.ok(document, "Hotel specification document must exist in the local fixture");
    const created = await createSpecificationJob(env, { documentId: document.id, userId: document.owner_user_id, reason: "Enterprise QA validation", chunkSize: 50 });
    assert.equal(created.job.status, "Queued");
    assert.equal(Number(created.job.total_pages), 2340);
    const chunks = DB.prepare("SELECT * FROM specification_extraction_chunks WHERE job_id=? ORDER BY chunk_number").bind(created.job.id).all().results;
    assert.equal(chunks.length, 47);
    assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, 47);
    const concurrent = await Promise.all([1, 2].map(() => createSpecificationJob(env, { documentId: document.id, userId: document.owner_user_id, reason: "Concurrent QA", chunkSize: 50 })));
    assert.ok(concurrent.every((result) => result.idempotent && result.job.id === created.job.id));

    let response = await handleSpecificationExtractionApi(request(document.id, "pause"), env, ctx);
    assert.equal(response.status, 200);
    assert.equal(DB.prepare("SELECT status FROM specification_extraction_jobs WHERE id=?").bind(created.job.id).first().status, "Paused");
    response = await handleSpecificationExtractionApi(request(document.id, "resume"), env, ctx);
    assert.equal(response.status, 200);
    assert.equal(queued.length, 1);

    const memoryBefore = process.memoryUsage().rss;
    const started = performance.now();
    await processSpecificationJob(env, { jobId: created.job.id });
    const firstDuration = performance.now() - started;
    const memoryDelta = process.memoryUsage().rss - memoryBefore;
    const firstCheckpoint = DB.prepare("SELECT * FROM specification_extraction_checkpoints WHERE job_id=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(created.job.id).first();
    assert.equal(Number(firstCheckpoint.processed_pages), 50);
    assert.equal(Number(firstCheckpoint.completed_chunks), 1);
    assert.ok(firstCheckpoint.resume_token);
    assert.ok(firstCheckpoint.worker_version);
    const firstCompleted = DB.prepare("SELECT page_to FROM specification_extraction_chunks WHERE id=?").bind(firstCheckpoint.chunk_id).first();
    assert.equal(Number(firstCheckpoint.current_page), Number(firstCompleted.page_to), "checkpoint page must identify the completed source range");
    assert.equal(DB.prepare("SELECT COUNT(*) count FROM specification_extraction_pages WHERE job_id=?").bind(created.job.id).first().count, 50);
    const firstSourceMetric = DB.prepare("SELECT source_access_method,source_read_count,source_read_bytes,source_bytes FROM specification_chunk_metrics WHERE chunk_id=?").bind(firstCheckpoint.chunk_id).first();
    assert.equal(firstSourceMetric.source_access_method, "R2 Range");
    assert.ok(Number(firstSourceMetric.source_read_count) > 0);
    assert.ok(Number(firstSourceMetric.source_read_bytes) < Number(firstSourceMetric.source_bytes));

    const completedBeforeRecovery = DB.prepare("SELECT COUNT(*) count FROM specification_extraction_chunks WHERE job_id=? AND status IN ('Completed','Needs Review')").bind(created.job.id).first().count;
    const abandoned = DB.prepare("SELECT id FROM specification_extraction_chunks WHERE job_id=? AND status='Queued' ORDER BY priority,chunk_number LIMIT 1").bind(created.job.id).first();
    DB.prepare("UPDATE specification_extraction_chunks SET status='Running',lease_owner='dead-worker',lease_expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(abandoned.id).run();
    await processSpecificationJob(env, { jobId: created.job.id });
    assert.equal(DB.prepare("SELECT status FROM specification_extraction_chunks WHERE id=?").bind(abandoned.id).first().status, "Completed");
    assert.equal(Number(DB.prepare("SELECT COUNT(*) count FROM specification_extraction_chunks WHERE job_id=? AND status IN ('Completed','Needs Review')").bind(created.job.id).first().count), Number(completedBeforeRecovery) + 1);

    const failedChunk = DB.prepare("SELECT id FROM specification_extraction_chunks WHERE job_id=? AND status='Queued' ORDER BY priority,chunk_number LIMIT 1").bind(created.job.id).first();
    DB.prepare("UPDATE specification_extraction_chunks SET attempt=2 WHERE id=?").bind(failedChunk.id).run();
    const pagesBeforeFailure = Number(DB.prepare("SELECT COUNT(*) count FROM specification_extraction_pages WHERE job_id=?").bind(created.job.id).first().count);
    storageAvailable = false;
    await processSpecificationJob(env, { jobId: created.job.id });
    assert.equal(DB.prepare("SELECT status FROM specification_extraction_chunks WHERE id=?").bind(failedChunk.id).first().status, "Failed");
    assert.equal(Number(DB.prepare("SELECT COUNT(*) count FROM specification_extraction_pages WHERE job_id=?").bind(created.job.id).first().count), pagesBeforeFailure);
    const retryRace = await Promise.all([1, 2].map(() => retrySpecificationChunk(DB, created.job.id, failedChunk.id)));
    assert.deepEqual(retryRace.sort(), [false, true], "two retry requests must enqueue the failed chunk once");
    storageAvailable = true;
    await processSpecificationJob(env, { jobId: created.job.id });
    assert.equal(DB.prepare("SELECT status FROM specification_extraction_chunks WHERE id=?").bind(failedChunk.id).first().status, "Completed");
    assert.equal(Number(DB.prepare("SELECT COUNT(*) count FROM specification_extraction_pages WHERE job_id=?").bind(created.job.id).first().count), pagesBeforeFailure + 50);
    assert.equal(Number(DB.prepare("SELECT COUNT(*)-COUNT(DISTINCT page_number) duplicates FROM specification_extraction_pages WHERE job_id=?").bind(created.job.id).first().duplicates), 0);
    assert.equal(Number(DB.prepare("SELECT COUNT(*)-COUNT(DISTINCT fingerprint) duplicates FROM specification_chunk_entities WHERE job_id=?").bind(created.job.id).first().duplicates), 0);

    if (process.env.QA_FULL_RUN === "1") {
      for (let guard = 0; guard < 60; guard += 1) {
        const state = DB.prepare("SELECT status FROM specification_extraction_jobs WHERE id=?").bind(created.job.id).first().status;
        if (["Completed", "Needs Review", "Failed"].includes(state)) break;
        await processSpecificationJob(env, { jobId: created.job.id });
      }
      const fullState = DB.prepare("SELECT status,processed_pages,completed_chunks,remaining_chunks FROM specification_extraction_jobs WHERE id=?").bind(created.job.id).first();
      assert.equal(fullState.status, "Completed");
      assert.equal(Number(fullState.processed_pages), 2340);
      assert.equal(Number(fullState.completed_chunks), 47);
      assert.equal(Number(fullState.remaining_chunks), 0);
      assert.equal(Number(DB.prepare("SELECT COUNT(*) count FROM specification_extraction_pages WHERE job_id=?").bind(created.job.id).first().count), 2340);
      assert.equal(Number(DB.prepare("SELECT COUNT(*)-COUNT(DISTINCT page_number) duplicates FROM specification_extraction_pages WHERE job_id=?").bind(created.job.id).first().duplicates), 0);
      DB.prepare("UPDATE specification_extraction_jobs SET status='Running',completed_at=NULL WHERE id=?").bind(created.job.id).run();
      DB.prepare("UPDATE specification_extraction_versions SET status='Running',completed_at=NULL WHERE id=?").bind(created.job.extraction_version_id).run();
    }

    await handleSpecificationExtractionApi(request(document.id, "cancel"), env, ctx);
    assert.equal(DB.prepare("SELECT status FROM specification_extraction_jobs WHERE id=?").bind(created.job.id).first().status, "Cancelled");
    assert.ok(DB.prepare("SELECT cancelled_at FROM specification_extraction_jobs WHERE id=?").bind(created.job.id).first().cancelled_at);
    assert.ok(Number(DB.prepare("SELECT COUNT(*) count FROM processing_history h JOIN specification_extraction_versions e ON e.processing_run_id=h.run_id WHERE e.id=? AND h.to_status IN ('Paused','Running','Cancelled')").bind(created.job.extraction_version_id).first().count) >= 3);

    DB.prepare("UPDATE document_processing_runs SET cancel_requested=0,status='Processing' WHERE id=(SELECT processing_run_id FROM specification_extraction_versions WHERE id=?)").bind(created.job.extraction_version_id).run();
    DB.prepare("UPDATE specification_extraction_jobs SET status='Running',processed_pages=0,completed_at=NULL,failed_at=NULL,cancelled_at=NULL WHERE id=?").bind(created.job.id).run();
    DB.prepare("UPDATE specification_extraction_chunks SET status='Failed' WHERE job_id=?").bind(created.job.id).run();
    await processSpecificationJob(env, { jobId: created.job.id });
    const failedJob = DB.prepare("SELECT status,failed_at FROM specification_extraction_jobs WHERE id=?").bind(created.job.id).first();
    assert.equal(failedJob.status, "Failed");
    assert.ok(failedJob.failed_at);

    DB.prepare("UPDATE document_processing_runs SET cancel_requested=0,status='Processing' WHERE id=(SELECT processing_run_id FROM specification_extraction_versions WHERE id=?)").bind(created.job.extraction_version_id).run();
    DB.prepare("UPDATE specification_extraction_jobs SET status='Running',processed_pages=total_pages,completed_at=NULL,failed_at=NULL WHERE id=?").bind(created.job.id).run();
    DB.prepare("UPDATE specification_extraction_chunks SET status='Completed' WHERE job_id=?").bind(created.job.id).run();
    await processSpecificationJob(env, { jobId: created.job.id });
    const completedJob = DB.prepare("SELECT status,completed_at FROM specification_extraction_jobs WHERE id=?").bind(created.job.id).first();
    assert.equal(completedJob.status, "Completed");
    assert.ok(completedJob.completed_at);

    if (process.env.QA_FULL_RUN === "1") {
      const repeated = await createSpecificationJob(env, { documentId: document.id, userId: document.owner_user_id, reason: "Determinism rerun", chunkSize: 50 });
      assert.equal(repeated.idempotent, false);
      for (let guard = 0; guard < 60; guard += 1) {
        const state = DB.prepare("SELECT status FROM specification_extraction_jobs WHERE id=?").bind(repeated.job.id).first().status;
        if (["Completed", "Needs Review", "Failed"].includes(state)) break;
        await processSpecificationJob(env, { jobId: repeated.job.id });
      }
      assert.equal(DB.prepare("SELECT status FROM specification_extraction_jobs WHERE id=?").bind(repeated.job.id).first().status, "Completed");
      const missingFromRepeat = DB.prepare("SELECT COUNT(*) count FROM (SELECT fingerprint FROM specification_chunk_entities WHERE job_id=? EXCEPT SELECT fingerprint FROM specification_chunk_entities WHERE job_id=?)").bind(created.job.id, repeated.job.id).first();
      const newInRepeat = DB.prepare("SELECT COUNT(*) count FROM (SELECT fingerprint FROM specification_chunk_entities WHERE job_id=? EXCEPT SELECT fingerprint FROM specification_chunk_entities WHERE job_id=?)").bind(repeated.job.id, created.job.id).first();
      assert.equal(Number(missingFromRepeat.count), 0);
      assert.equal(Number(newInRepeat.count), 0);
      assert.equal(Number(DB.prepare("SELECT COUNT(*)-COUNT(DISTINCT page_number) duplicates FROM specification_extraction_pages WHERE job_id=?").bind(repeated.job.id).first().duplicates), 0);
    }

    const duration = DB.prepare("SELECT ROUND(AVG(duration_ms)) average_ms,MIN(duration_ms) fastest_ms,MAX(duration_ms) slowest_ms FROM specification_extraction_chunks WHERE job_id=? AND duration_ms IS NOT NULL").bind(created.job.id).first();
    const writes = DB.prepare("SELECT (SELECT COUNT(*) FROM specification_extraction_pages WHERE job_id=?) pages,(SELECT COUNT(*) FROM specification_chunk_entities WHERE job_id=?) entities,(SELECT COUNT(*) FROM specification_extraction_checkpoints WHERE job_id=?) checkpoints,(SELECT COUNT(*) FROM specification_extraction_failures WHERE job_id=?) failures").bind(created.job.id, created.job.id, created.job.id, created.job.id).first();
    process.stdout.write(`\nHOTEL_QA_METRICS ${JSON.stringify({ pages: 2340, chunks: 47, firstChunkMs: Math.round(firstDuration), firstChunkMemoryDeltaBytes: memoryDelta, chunkDurationMs: duration, persistedWrites: writes })}\n`);
  } finally { DB.close(); }
});
