import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  visionJobFingerprint, isCurrentVisionRun, assertProjectScope,
  createOrGetVisionJob, processVisionRun,
  VISION_CONTRACT_VERSION, VISION_ACTIVE_PRODUCTION_GENERATION, VISION_MUSE_SHADOW_GENERATION,
} from "../worker/drawing-vision-background.mjs";
import { classifyMuseOutcome, MUSE_VISION_MODEL_CONFIG_VERSION } from "../worker/drawing-vision-muse-provider.mjs";
import { handleDrawingVisionQueueApi } from "../worker/drawing-vision-queue-api.mjs";

// Minimal-schema + single-user D1 shim convention (cf. drawing-extraction-api.test.mjs).
const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  async batch(statements) {
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

const MIGRATION = readFileSync(new URL("../drizzle/0065_drawing_vision_async_shadow.sql", import.meta.url), "utf8");

const seed = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT);
    CREATE TABLE drawing_intake_versions(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE drawing_legend_entries(id TEXT PRIMARY KEY, legend_id TEXT, sequence INTEGER, label TEXT, description TEXT);
    CREATE TABLE drawing_legends(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT);
    CREATE TABLE drawing_extraction_proposals(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, intake_version_id TEXT, page_number INTEGER, proposal_key TEXT, proposal_type TEXT, raw_label TEXT, normalized_value TEXT, bounding_box TEXT, confidence INTEGER, authority_role TEXT, governed_status TEXT, hard_review_reasons TEXT, evidence TEXT, source_references TEXT, extraction_method TEXT, extraction_version TEXT, review_status TEXT, reviewed_by TEXT, created_at TEXT, updated_at TEXT, visual_run_id TEXT, superseded_at TEXT, superseded_by_run_id TEXT);
  `);
  raw.exec(MIGRATION);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','Test',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1');
    INSERT INTO drawing_intake_versions VALUES ('iv1','p1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO documents VALUES ('doc2','p2','dv2',NULL);
    INSERT INTO document_versions VALUES ('dv2','doc2');
    INSERT INTO drawing_intake_versions VALUES ('iv2','p2','doc2','dv2',1,'Completed',NULL);
  `);
  const files = new Map();
  const env = {
    DB: d1(raw),
    FILES: {
      put: async (key, bytes) => { files.set(key, bytes); },
      get: async (key) => (files.has(key) ? { arrayBuffer: async () => files.get(key).buffer.slice(0) } : null),
    },
    NVIDIA_API_KEY: "test-key-never-a-secret",
  };
  return { raw, env, files };
};

const crops = (over = {}) => [{ index: 0, kind: "crop", cropRect: { x: 1, y: 2, w: 3, h: 4 }, pageNumber: 1, sha256: "aaa", objectKey: "k0", ...over }];
const jobInput = (over = {}) => ({
  projectId: "p1", documentId: "doc1", documentVersionId: "dv1", intakeVersionId: "iv1",
  pageNumber: 1, crops: crops(), ...over,
});

test("1. same crop manifest yields the idempotent same active job", async () => {
  const { env } = seed();
  const first = await createOrGetVisionJob(env.DB, jobInput());
  const second = await createOrGetVisionJob(env.DB, jobInput());
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.run.id, second.run.id);
});

test("2. changed cropRect/kind/image yields a new fingerprint", async () => {
  const { env } = seed();
  const a = await createOrGetVisionJob(env.DB, jobInput());
  const b = await createOrGetVisionJob(env.DB, jobInput({ crops: crops({ cropRect: { x: 9, y: 9, w: 9, h: 9 } }) }));
  const c = await createOrGetVisionJob(env.DB, jobInput({ crops: crops({ kind: "overview" }) }));
  const d = await createOrGetVisionJob(env.DB, jobInput({ crops: crops({ sha256: "bbb" }) }));
  assert.notEqual(a.run.id, b.run.id);
  assert.notEqual(a.run.id, c.run.id);
  assert.notEqual(a.run.id, d.run.id);
  // Same bytes but different role/region must not collapse (explicit serialization check).
  const fa = visionJobFingerprint({ ...jobInput(), contractVersion: VISION_CONTRACT_VERSION, modelConfigVersion: MUSE_VISION_MODEL_CONFIG_VERSION });
  const fb = visionJobFingerprint({ ...jobInput(), crops: crops({ kind: "overview" }), contractVersion: VISION_CONTRACT_VERSION, modelConfigVersion: MUSE_VISION_MODEL_CONFIG_VERSION });
  assert.notEqual(fa.key, fb.key);
  assert.ok(fa.key.includes('"kind":"crop"') && fb.key.includes('"kind":"overview"'));
});

test("3. foreign project evidence is rejected", async () => {
  const { env } = seed();
  // Intake row points at doc2 but carries another project's scope.
  await env.DB.prepare("INSERT INTO drawing_intake_versions VALUES ('ivX','p1','doc2','dv2',9,'Completed',NULL)").run();
  await assert.rejects(
    assertProjectScope(env.DB, { documentId: "doc2", intakeVersionId: "ivX" }),
    (e) => e.code === "FOREIGN_PROJECT_EVIDENCE",
  );
  // And an intake belonging to another document is refused as not-current.
  await assert.rejects(
    assertProjectScope(env.DB, { documentId: "doc2", intakeVersionId: "iv1" }),
    (e) => e.code === "DRAWING_INTAKE_REQUIRED",
  );
});

test("4. stale document version is rejected at claim time", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  // Document head moves after the job was queued.
  await env.DB.prepare("UPDATE documents SET current_version_id='dv9' WHERE id='doc1'").run();
  const out = await processVisionRun(env, { runId: run.id });
  assert.equal(out.stale, true);
  const row = await env.DB.prepare("SELECT status FROM drawing_visual_runs WHERE id=?").bind(run.id).first();
  assert.equal(row.status, "Failed");
});

test("5. stale intake version is rejected at claim time", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.DB.prepare("UPDATE drawing_intake_versions SET superseded_at='x' WHERE id='iv1'").run();
  await env.DB.prepare("INSERT INTO drawing_intake_versions VALUES ('iv3','p1','doc1','dv1',2,'Completed',NULL)").run();
  const out = await processVisionRun(env, { runId: run.id });
  assert.equal(out.stale, true);
});

test("6. old config generation cannot masquerade as current", () => {
  const heads = { currentDocumentVersionId: "dv1", currentIntakeVersionId: "iv1", activeGeneration: VISION_ACTIVE_PRODUCTION_GENERATION };
  const shadow = { document_version_id: "dv1", intake_version_id: "iv1", superseded_at: null, vision_generation: VISION_MUSE_SHADOW_GENERATION };
  const llava = { document_version_id: "dv1", intake_version_id: "iv1", superseded_at: null, vision_generation: VISION_ACTIVE_PRODUCTION_GENERATION };
  assert.equal(isCurrentVisionRun(shadow, heads), false);
  assert.equal(isCurrentVisionRun(llava, heads), true);
  // After a future cutover flips the active generation, the old LLaVA result fails.
  assert.equal(isCurrentVisionRun(llava, { ...heads, activeGeneration: "muse-production-1" }), false);
  assert.equal(isCurrentVisionRun({ ...llava, superseded_at: "x" }, heads), false);
});

test("7. duplicate queue delivery does not duplicate proposals", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.FILES.put("k0", new Uint8Array([1, 2, 3]));
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: "S smoke detector" }, finish_reason: "stop" }], usage: {} }), { status: 200 });
  const withFetch = { ...env, NVIDIA_API_KEY: "k" };
  const realProcess = await import("../worker/drawing-vision-background.mjs");
  // Inject stub fetch via env override consumed by provider's fetchImpl default is global;
  // instead stub global fetch for this test.
  const origFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await realProcess.processVisionRun(withFetch, { runId: run.id });
    // Simulate redelivery after completion: terminal, no new work.
    const again = await realProcess.processVisionRun(withFetch, { runId: run.id });
    assert.equal(again.terminal, true);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM drawing_extraction_proposals WHERE visual_run_id=?").bind(run.id).first();
    assert.equal(count.n, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("8. lease prevents simultaneous processing", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.FILES.put("k0", new Uint8Array([1]));
  await env.FILES.put("k0", new Uint8Array([1]));
  const slowFetch = (_url, { signal } = {}) => new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error("slow provider"), { name: "AbortError" }));
    if (signal) {
      if (signal.aborted) return fail();
      signal.addEventListener("abort", fail);
      // Test-only bound: the provider would hang past any reasonable assertion
      // window; fail fast so the suite stays fast while the lease is proven held.
      setTimeout(fail, 2000);
    } else {
      setTimeout(fail, 2000);
    }
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = slowFetch;
  try {
    const first = processVisionRun({ ...env, NVIDIA_API_KEY: "k" }, { runId: run.id });
    await new Promise((r) => setTimeout(r, 100));
    const second = await processVisionRun({ ...env, NVIDIA_API_KEY: "k" }, { runId: run.id });
    assert.equal(second.claimed, false);
    const row = await env.DB.prepare("SELECT status,attempt FROM drawing_visual_runs WHERE id=?").bind(run.id).first();
    assert.equal(row.status, "Running");
    assert.equal(row.attempt, 1);
    await Promise.race([first.catch(() => null), new Promise((r) => setTimeout(() => r("timeout-guard"), 500))]);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("9. expired lease becomes retryable", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.DB.prepare("UPDATE drawing_visual_runs SET status='Running',lease_owner='dead',lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(run.id).run();
  await env.FILES.put("k0", new Uint8Array([1]));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200 });
  try {
    const out = await processVisionRun({ ...env, NVIDIA_API_KEY: "k" }, { runId: run.id });
    assert.equal(out.terminal, true);
    const row = await env.DB.prepare("SELECT status FROM drawing_visual_runs WHERE id=?").bind(run.id).first();
    assert.equal(row.status, "Completed");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("10. provider 5xx and timeout retry; semantic Needs Review does not", async () => {
  // classifyMuseOutcome is the unit under test (no network).
  assert.equal(classifyMuseOutcome({ status: 500, body: null, durationMs: 1 }).code, "AI_PROVIDER_SERVER_ERROR");
  assert.equal(classifyMuseOutcome({ status: 429, body: null, durationMs: 1 }).code, "AI_PROVIDER_RATE_LIMITED");
  assert.equal(classifyMuseOutcome({ status: 200, body: { choices: [{ message: { content: "  " }, finish_reason: "stop" }] }, durationMs: 1 }).code, "AI_PROVIDER_EMPTY_CONTENT");
  assert.equal(classifyMuseOutcome({ status: 200, body: { choices: [{ message: { content: "abc" }, finish_reason: "length" }] }, durationMs: 1 }).code, "AI_PROVIDER_TRUNCATED");
  const ok = classifyMuseOutcome({ status: 200, body: { choices: [{ message: { content: "NEEDS REVIEW" }, finish_reason: "stop" }] }, durationMs: 1 });
  assert.equal(ok.code, null);
  // Worker-level: a 500 throws a transport error, which retries while attempts remain.
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.FILES.put("k0", new Uint8Array([1]));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  try {
    const out = await processVisionRun({ ...env, NVIDIA_API_KEY: "k" }, { runId: run.id });
    assert.equal(out.retried, true);
    const row = await env.DB.prepare("SELECT status,attempt FROM drawing_visual_runs WHERE id=?").bind(run.id).first();
    assert.equal(row.status, "Retrying");
    assert.equal(row.attempt, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("11. semantic Needs Review completes without retry", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.FILES.put("k0", new Uint8Array([1]));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "NEEDS REVIEW: illegible" }, finish_reason: "stop" }] }), { status: 200 });
  try {
    const out = await processVisionRun({ ...env, NVIDIA_API_KEY: "k" }, { runId: run.id });
    assert.equal(out.terminal, true);
    assert.equal(out.retried, undefined);
    const row = await env.DB.prepare("SELECT status FROM drawing_visual_runs WHERE id=?").bind(run.id).first();
    assert.equal(row.status, "Completed");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("12. stale job cannot publish current proposals", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.FILES.put("k0", new Uint8Array([1]));
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    // Document head moves DURING the Muse call.
    await env.DB.prepare("UPDATE documents SET current_version_id='dv9' WHERE id='doc1'").run();
    return new Response(JSON.stringify({ choices: [{ message: { content: "S" }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    const out = await processVisionRun({ ...env, NVIDIA_API_KEY: "k" }, { runId: run.id });
    assert.equal(calls, 1);
    assert.equal(out.published, false);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM drawing_extraction_proposals WHERE visual_run_id=?").bind(run.id).first();
    assert.equal(count.n, 0);
    const row = await env.DB.prepare("SELECT status FROM drawing_visual_runs WHERE id=?").bind(run.id).first();
    assert.equal(row.status, "Completed"); // auditable history retained
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("13. successful finalization produces Needs Review AI proposals, never quantity authority", async () => {
  const { env } = seed();
  const { run } = await createOrGetVisionJob(env.DB, jobInput());
  await env.FILES.put("k0", new Uint8Array([1, 2, 3]));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "T telephone jack, 2Nos visible" }, finish_reason: "stop" }] }), { status: 200 });
  try {
    const out = await processVisionRun({ ...env, NVIDIA_API_KEY: "k" }, { runId: run.id });
    assert.equal(out.published, true);
    const rows = await env.DB.prepare("SELECT * FROM drawing_extraction_proposals WHERE visual_run_id=?").bind(run.id).all();
    assert.equal(rows.results.length, 1);
    const proposal = rows.results[0];
    assert.equal(proposal.review_status, "Needs Review");
    assert.equal(proposal.authority_role, "Unsupported");
    assert.equal(proposal.extraction_method, "Muse visual analysis (shadow)");
    // Shadow method must NOT match the production prefix read.
    assert.ok(!proposal.extraction_method.startsWith("AI visual analysis"));
    // No quantity authority anywhere: normalized_value stays null, evidence carries quarantine note.
    assert.equal(proposal.normalized_value, null);
    const evidence = JSON.parse(proposal.evidence);
    assert.ok(evidence.fullText.includes("2Nos"));
    const runRow = await env.DB.prepare("SELECT status,error_code FROM drawing_visual_runs WHERE id=?").bind(run.id).first();
    assert.equal(runRow.status, "Completed");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("14. handoff requires shadow mode, validates, stores, and returns 202 with status URL", async () => {
  const { env } = seed();
  const sent = [];
  const queueEnv = { ...env, VISION_QUEUE: { send: async (m) => { sent.push(m); } } };
  const req = (path, body) => new Request(`https://app.example${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const png = Buffer.from([137, 80, 78, 71]).toString("base64");
  // No mode -> refused, production untouched.
  const refused = await handleDrawingVisionQueueApi(
    req("/api/documents/doc1/drawing-vision/async", { pageNumber: 1, images: [{ base64: png, kind: "crop" }] }),
    env, { waitUntil() {} },
  );
  assert.equal(refused.status, 400);
  // Shadow mode -> 202 with run + status URL. The VISION_QUEUE binding records
  // the dispatch; no background work runs inside this test.
  const accepted = await handleDrawingVisionQueueApi(
    req("/api/documents/doc1/drawing-vision/async", { mode: "muse-shadow", pageNumber: 1, images: [{ base64: png, kind: "crop", cropRect: { x: 1 } }] }),
    queueEnv, { waitUntil() {} },
  );
  assert.equal(accepted.status, 202);
  const payload = await accepted.json();
  assert.ok(payload.runId && payload.statusUrl.includes(payload.runId));
  assert.equal(payload.idempotent, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].runId, payload.runId);
  // Repeat -> idempotent same job, no second dispatch.
  const repeat = await handleDrawingVisionQueueApi(
    req("/api/documents/doc1/drawing-vision/async", { mode: "muse-shadow", pageNumber: 1, images: [{ base64: png, kind: "crop", cropRect: { x: 1 } }] }),
    queueEnv,
    { waitUntil() {} },
  );
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).runId, payload.runId);
  assert.equal(sent.length, 1);
  // Status endpoint reflects the queued run.
  const statusRes = await handleDrawingVisionQueueApi(
    new Request(`https://app.example/api/documents/doc1/drawing-vision/runs/${payload.runId}`), queueEnv, { waitUntil() {} },
  );
  assert.equal(statusRes.status, 200);
  assert.equal((await statusRes.json()).status, "Queued");
  // Foreign document mismatch -> 403.
  const foreign = await handleDrawingVisionQueueApi(
    new Request(`https://app.example/api/documents/doc2/drawing-vision/runs/${payload.runId}`), queueEnv, { waitUntil() {} },
  );
  assert.equal(foreign.status, 403);
});
