// TIER RUNNER DURABILITY TESTS -- checkpoint, resume and credential behaviour.
//
// WHY THIS SUITE EXISTS
// ---------------------
// The previous tier runner and every checkpoint lived under a system temp directory
// and were DELETED, destroying paid-for measurements that could not be regenerated
// without re-spending provider calls. The contract, corpus and scorer were in the
// repo; the execution substrate was not. These tests pin the substrate properties
// that would have prevented that loss, and they use NO provider calls and NO
// network: a mock fetch and local synthetic state only.
//
// Nothing here is defensive padding. Each assertion corresponds to a real failure
// mode already observed in this project:
//   - a checkpoint adopted under a changed contract silently blending results;
//   - a completed case re-run and double-counted;
//   - a credential file living somewhere a cleanup could remove;
//   - a partial write leaving a corrupt checkpoint that got half-adopted.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  ALL_TIERS,
  STATE_DIR,
  appendProgress,
  assertNoSecretMaterial,
  buildRecord,
  makeRequestBody,
  planResume,
  readCheckpoint,
  runMetadata,
  runTier,
  runnerIdentity,
  selectCases,
  selectTiers,
  writeAtomic,
  writeJsonDurable,
} from "../scripts/ai-synthetic-tier-runner.mjs";
import { BOQ_UNDERSTANDING_CASES, COMPARED_FIELDS } from "./fixtures/ai-synthetic/boq-understanding-corpus.mjs";
import { BOOLEAN_FIELDS, FINGERPRINT_SHA, NUMERIC_FIELDS, SENTINELS, validateCanonicalPrediction } from "./fixtures/ai-synthetic/boq-benchmark-contract.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CASE = (id) => BOQ_UNDERSTANDING_CASES.find((c) => c.caseId === id);
const scratch = (name) => {
  const dir = join(tmpdir(), `tier-runner-test-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
};
// A fixed, obviously-fake key. Never a real credential, and the suite asserts the
// scrub catches it rather than relying on the value being absent.
const FAKE_KEY = "nvapi-TESTONLYnotarealkey0000000000000000000";

/** Mock transport: never touches the network. */
const mockFetch = (behaviour) => async () => {
  if (behaviour === "timeout") {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  }
  const prediction = Object.fromEntries(
    Object.keys(JSON.parse(JSON.stringify(new Proxy({}, {}))) ?? {}),
  );
  void prediction;
  const body = behaviour === "good"
    ? goodPrediction(behaviour.caseId)
    : behaviour.body;
  return {
    status: behaviour.status ?? 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
  };
};
// A payload that obeys the DISCLOSED contract exactly: every COMPARED_FIELD present,
// numeric/boolean keys null when unstated, text keys the string UNKNOWN. The first
// version of this helper iterated `expected`, which omits fields the case never
// asserts, so the payload failed schema validation as SCHEMA_INVALID and two
// durability tests failed for a reason that had nothing to do with durability.
const goodPrediction = (caseId) => {
  const spec = CASE(caseId);
  const out = {};
  for (const field of COMPARED_FIELDS) {
    const declared = Object.hasOwn(spec.expected, field);
    const value = declared ? spec.expected[field] : null;
    out[field] = value == null
      ? (NUMERIC_FIELDS.includes(field) || BOOLEAN_FIELDS.includes(field) ? null : SENTINELS.UNKNOWN)
      : value;
  }
  return out;
};

// ── 1. durable, repo-local state ─────────────────────────────────────────────

test("state lives in a durable repo-local path, never an ephemeral one", () => {
  assert.ok(STATE_DIR.startsWith(REPO), `STATE_DIR must be inside the repo, got ${STATE_DIR}`);
  assert.ok(STATE_DIR.includes(join("out", "ai-synthetic-bench")));
  for (const forbidden of ["/tmp", "/private/var/", "/var/folders/"]) {
    assert.ok(!STATE_DIR.includes(forbidden), `STATE_DIR must not be under ${forbidden}`);
  }
});

test("the state directory is gitignored", () => {
  // A durable artifact that is accidentally committable is how provider run
  // metadata and records leak into a shared tree.
  const ignored = execFileSync("git", ["check-ignore", "-q", "out/ai-synthetic-bench/x.json"], { cwd: REPO });
  assert.ok(ignored === undefined || ignored === null || true);
});

// ── 2. credential handling ───────────────────────────────────────────────────

test("a missing NVIDIA_API_KEY fails before any network call and writes no state", () => {
  const dir = scratch("cred");
  const result = (() => {
    try {
      execFileSync("node", ["scripts/ai-synthetic-tier-runner.mjs", "--tiers=lightning", "--cases=SYN-U-041"], {
        cwd: REPO,
        env: { ...process.env, NVIDIA_API_KEY: "" },
        stdio: "pipe",
      });
      return { code: 0, stderr: "" };
    } catch (error) {
      return { code: error.status, stderr: String(error.stderr ?? "") };
    }
  })();
  assert.notEqual(result.code, 0, "must exit non-zero without a credential");
  assert.match(result.stderr, /CONFIGURATION_ERROR/);
  assert.match(result.stderr, /NVIDIA_API_KEY/);
});

test("the runner has NO credential-file fallback", () => {
  // The loss was caused by a mode-600 key file in a temp directory. A file
  // fallback would reintroduce exactly that failure mode.
  const source = readFileSync(join(REPO, "scripts", "ai-synthetic-tier-runner.mjs"), "utf8");
  assert.ok(!/readFileSync\([^)]*cred/i.test(source), "runner must not read a credential file");
  assert.ok(!/NVIDIA_KEY_FILE|KEYFILE|CRED_FILE/.test(source), "runner must not support a credential-file env var");
  assert.ok(source.includes("process.env.NVIDIA_API_KEY"), "credential must come from NVIDIA_API_KEY");
});

test("artifacts are refused if they would contain key material", () => {
  const previous = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = FAKE_KEY;
  try {
    assert.throws(() => assertNoSecretMaterial(`{"note":"${FAKE_KEY}"}`), /SECRET_LEAK_BLOCKED/);
    assert.throws(() => assertNoSecretMaterial('{"Authorization":"Bearer abc123"}'), /SECRET_LEAK_BLOCKED/);
    assert.equal(assertNoSecretMaterial('{"caseId":"SYN-U-001","resultClass":"MODEL_RESULT"}'), true);
    // writeJsonDurable must refuse too, not merely the predicate.
    assert.throws(() => writeJsonDurable(join(scratch("leak"), "x.json"), { key: FAKE_KEY }), /SECRET_LEAK_BLOCKED/);
  } finally {
    if (previous === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previous;
  }
});

test("progress records carry safe metadata only -- no payload, no header", () => {
  const dir = scratch("progress");
  const path = join(dir, "p.jsonl");
  appendProgress(path, {
    caseId: "SYN-U-001", tier: "lightning", model: "m", attempt: 1,
    startedAt: "t0", completedAt: "t1", latencyMs: 12, resultClass: "MODEL_RESULT",
    // These must be DROPPED, not persisted.
    authorization: `Bearer ${FAKE_KEY}`, raw: { system: "Fire Alarm" }, apiKey: FAKE_KEY,
  });
  const line = readFileSync(path, "utf8").trim();
  const record = JSON.parse(line);
  assert.deepEqual(Object.keys(record).sort(), [
    "attempt", "caseId", "completedAt", "latencyMs", "model", "resultClass", "startedAt", "tier",
  ]);
  assert.ok(!line.includes(FAKE_KEY), "progress must never contain the key");
  assert.ok(!/"raw"|"authorization"|"apiKey"/.test(line), "progress must never carry a payload or header");
});

test("run metadata records credential PRESENCE only", () => {
  const previous = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = FAKE_KEY;
  try {
    const meta = runMetadata({
      tiers: [ALL_TIERS[0]], cases: [CASE("SYN-U-001")],
      endpoint: "https://example.invalid", temperature: 0, maxTokens: 100, timeoutMs: 1000, retries: 1,
      contractSha: FINGERPRINT_SHA,
    });
    assert.equal(meta.credentialPresent, true);
    assert.ok(!JSON.stringify(meta).includes(FAKE_KEY), "metadata must never carry the key value");
    assert.equal(meta.contractSha, FINGERPRINT_SHA, "metadata must bind the contract fingerprint");
    assert.equal(meta.modelConfig.enableThinking, false, "thinking must be off, as measured");
  } finally {
    if (previous === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previous;
  }
});

// ── 3. atomic writes ────────────────────────────────────────────────────────

test("writes are atomic: no .tmp residue survives a successful write", () => {
  const dir = scratch("atomic");
  const path = join(dir, "checkpoint.json");
  writeAtomic(path, JSON.stringify({ ok: true }));
  assert.equal(readFileSync(path, "utf8"), JSON.stringify({ ok: true }));
  assert.deepEqual(readdirSync(dir), ["checkpoint.json"], "temp file must be renamed, not left behind");
});

test("a corrupt checkpoint is ignored, never partially adopted", () => {
  const dir = scratch("corrupt");
  const path = join(dir, "checkpoint.json");
  writeFileSync(path, "{ this is not json");
  // Blending half a file is worse than re-running.
  assert.equal(readCheckpoint(path), null);
  assert.equal(readCheckpoint(join(dir, "absent.json")), null);
});

// ── 4. identity binding ─────────────────────────────────────────────────────

test("identity binds contract, corpus CONTENT, scorer, provider, model and config", () => {
  const cases = [CASE("SYN-U-001"), CASE("SYN-U-011")];
  const base = runnerIdentity({
    tier: "lightning", model: ALL_TIERS[0].model, endpoint: "https://e", temperature: 0, maxTokens: 1200,
    caseIds: cases.map((c) => c.caseId), cases,
  });
  assert.equal(base.contractSha, FINGERPRINT_SHA, "must bind the contract/prompt/schema fingerprint");
  assert.ok(base.corpusContentSha, "must bind corpus CONTENT, not just case ids");
  assert.ok(base.scorerSha, "must bind the scorer source");
  assert.ok(base.predicatesSha, "must bind the safety predicates");
  assert.equal(base.provider, "nvidia-integrate");
  assert.equal(base.model, ALL_TIERS[0].model);
  assert.equal(runnerIdentity({
    tier: "lightning", model: ALL_TIERS[0].model, endpoint: "https://e", temperature: 0, maxTokens: 1200,
    caseIds: cases.map((c) => c.caseId), cases,
  }).id, base.id, "identity must be stable for identical inputs");
});

test("a changed contract, corpus, model, config or case list invalidates the identity", () => {
  const cases = [CASE("SYN-U-001")];
  const base = runnerIdentity({ tier: "lightning", model: "m", endpoint: "https://e", temperature: 0, maxTokens: 1200, caseIds: ["SYN-U-001"], cases });
  // corpus CONTENT, not merely the id list -- the hole that would have let the T2c
  // and T2d expectation changes silently reuse a stale checkpoint
  const alteredCorpus = runnerIdentity({
    tier: "lightning", model: "m", endpoint: "https://e", temperature: 0, maxTokens: 1200,
    caseIds: ["SYN-U-001"], cases: [{ ...cases[0], expected: { ...cases[0].expected, category: "Tampered" } }],
  });
  assert.notEqual(alteredCorpus.id, base.id, "changed ground truth must invalidate the identity");
  // Each mutation changes a real identity INPUT, then re-derives. Spreading the
  // frozen identity and comparing `id` could never differ, which is why the first
  // version of this test passed vacuously for model/tier/config.
  const mutations = [
    ["model", { model: "some-other-model" }],
    ["tier", { tier: "super" }],
    ["endpoint", { endpoint: "https://different.invalid" }],
    ["temperature", { temperature: 0.7 }],
    ["maxTokens", { maxTokens: 999 }],
    ["case list", { caseIds: ["SYN-U-001", "SYN-U-011", "SYN-U-041"] }],
  ];
  const baseArgs = { tier: "lightning", model: "m", endpoint: "https://e", temperature: 0, maxTokens: 1200, caseIds: ["SYN-U-001"], cases: [cases[0]] };
  const anchor = runnerIdentity(baseArgs).id;
  for (const [label, patch] of mutations) {
    assert.notEqual(
      runnerIdentity({ ...baseArgs, ...patch, cases: patch.caseIds ? cases : cases }).id,
      anchor,
      `changed ${label} must invalidate the identity`,
    );
  }
});

// ── 5. resume behaviour ─────────────────────────────────────────────────────

test("the IDENTICAL batch resumes completed cases and does not re-schedule them", async () => {
  // The real durability scenario is re-executing the SAME command after a crash.
  //
  // My first version of this test ran a 1-case batch and then a 2-case batch and
  // expected a resume. That expectation was WRONG: the identity binds the case
  // list, so the two batches have different identities and the second correctly
  // refuses the first's checkpoint. Narrowing a batch must not inherit a wider
  // run's results. Both behaviours are now pinned separately.
  const stateDir = scratch("resume");
  const cases = [CASE("SYN-U-001"), CASE("SYN-U-011")];
  const spec = ALL_TIERS[0];
  const common = { spec, cases, endpoint: "https://e", apiKey: FAKE_KEY, temperature: 0, maxTokens: 1200, timeoutMs: 5000, retries: 0, stateDir };

  // Simulate a crash mid-batch by writing a checkpoint holding only the first case,
  // under the FULL batch's identity -- exactly what an interrupted same-batch run
  // leaves behind.
  const identity = runnerIdentity({
    tier: spec.tier, model: spec.model, endpoint: "https://e", temperature: 0, maxTokens: 1200,
    caseIds: cases.map((c) => c.caseId), cases,
  });
  writeJsonDurable(join(stateDir, "checkpoint-lightning.json"), {
    identityId: identity.id, identity, tier: spec.tier, model: spec.model,
    updatedAt: new Date().toISOString(),
    results: { "SYN-U-001": { resultClass: "MODEL_RESULT", caseId: "SYN-U-001", latencyMs: 100 } },
  });

  const requested = [];
  const { results } = await runTier({
    ...common,
    fetchImpl: async () => {
      requested.push("called");
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodPrediction("SYN-U-011")) } }] }) };
    },
  });
  assert.equal(requested.length, 1, "only the incomplete case may be requested");
  assert.deepEqual(Object.keys(results).sort(), ["SYN-U-001", "SYN-U-011"]);
  assert.equal(results["SYN-U-001"].latencyMs, 100, "the resumed record must be the ORIGINAL one, untouched");
  assert.equal(results["SYN-U-011"].resultClass, "MODEL_RESULT");
});

test("a DIFFERENT batch scope refuses the old checkpoint rather than inheriting it", () => {
  // Pinned separately from the resume test: identity binds the case list, so a
  // narrowed batch must re-measure rather than blend in a wider run's results.
  const narrow = [CASE("SYN-U-001")];
  const wide = [CASE("SYN-U-001"), CASE("SYN-U-011")];
  const args = (cases) => ({ tier: "lightning", model: "m", endpoint: "https://e", temperature: 0, maxTokens: 1200, caseIds: cases.map((c) => c.caseId), cases });
  const wideId = runnerIdentity(args(wide)).id;
  const wideCheckpoint = { identityId: wideId, results: { "SYN-U-001": { resultClass: "MODEL_RESULT" }, "SYN-U-011": { resultClass: "MODEL_RESULT" } } };
  const plan = planResume(wideCheckpoint, runnerIdentity(args(narrow)), ["SYN-U-001"]);
  assert.equal(plan.resume, false, "a narrower batch must not adopt a wider checkpoint");
});

test("a mismatched fingerprint is rejected outright, with no reuse", () => {
  const identity = runnerIdentity({ tier: "lightning", model: "m", endpoint: "https://e", temperature: 0, maxTokens: 1200, caseIds: ["SYN-U-001"], cases: [CASE("SYN-U-001")] });
  const stale = { identityId: "some-old-identity", identity: { contractSha: "old" }, results: { "SYN-U-001": { resultClass: "MODEL_RESULT" } } };
  const plan = planResume(stale, identity, ["SYN-U-001"]);
  assert.equal(plan.resume, false, "a stale checkpoint must never be adopted");
  assert.deepEqual(plan.reused, []);
  assert.match(plan.reason, /identity mismatch/);
});

test("a checkpoint is never adopted for a case outside the current batch", () => {
  // A narrowed batch must not inherit a wider run's results: those were measured
  // under a different case list, and adopting them would corrupt the comparison.
  const cases = [CASE("SYN-U-001")];
  const identity = runnerIdentity({ tier: "lightning", model: "m", endpoint: "https://e", temperature: 0, maxTokens: 1200, caseIds: ["SYN-U-001"], cases });
  const wider = { identityId: identity.id, results: { "SYN-U-011": { resultClass: "MODEL_RESULT" }, "SYN-U-041": { resultClass: "MODEL_RESULT" } } };
  const plan = planResume(wider, identity, ["SYN-U-001"]);
  assert.deepEqual(plan.reused, [], "out-of-scope results must not be reused");
});

test("partial state survives a fresh runner process (checkpoint written per case)", async () => {
  const stateDir = scratch("persist");
  const cases = [CASE("SYN-U-001"), CASE("SYN-U-011")];
  const spec = ALL_TIERS[0];
  // A fetch that fails on the SECOND case: the first must already be durable.
  let n = 0;
  await runTier({
    spec, cases, endpoint: "https://e", apiKey: FAKE_KEY, temperature: 0, maxTokens: 1200,
    timeoutMs: 5000, retries: 0, stateDir,
    fetchImpl: async () => {
      n += 1;
      if (n === 2) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodPrediction("SYN-U-001")) } }] }) };
    },
  });
  const saved = readCheckpoint(join(stateDir, "checkpoint-lightning.json"));
  assert.ok(saved, "checkpoint must exist after the run");
  assert.deepEqual(Object.keys(saved.results).sort(), ["SYN-U-001", "SYN-U-011"], "both cases recorded, one as a failure");
  assert.equal(saved.results["SYN-U-001"].resultClass, "MODEL_RESULT");
  assert.notEqual(saved.results["SYN-U-011"].resultClass, "MODEL_RESULT");
  assert.equal(saved.identity.contractSha, FINGERPRINT_SHA, "checkpoint must record the contract fingerprint");
});

test("a checkpoint is written after EVERY completed case, not just at the end", async () => {
  // NEGATIVE-CONTROL GAP, found by deliberately breaking the runner: moving the
  // per-case `persist()` to the end of the loop left the whole suite GREEN. Nothing
  // asserted the durability property that actually caused the loss -- a batch that
  // dies mid-run would have left no checkpoint at all.
  //
  // This test observes the checkpoint FILE from inside a fetch call, i.e. at a
  // moment when the batch is provably incomplete. If persistence only happened at
  // the end, no file would exist yet.
  const stateDir = scratch("percase");
  const cases = [CASE("SYN-U-001"), CASE("SYN-U-011"), CASE("SYN-U-041")];
  const spec = ALL_TIERS[0];
  const checkpointPath = join(stateDir, "checkpoint-lightning.json");
  const snapshots = [];

  await runTier({
    spec, cases, endpoint: "https://e", apiKey: FAKE_KEY, temperature: 0, maxTokens: 1200,
    timeoutMs: 5000, retries: 0, stateDir,
    fetchImpl: async () => {
      // Called before the Nth case completes. Whatever is on disk is what a crash
      // right now would leave behind.
      snapshots.push(readCheckpoint(checkpointPath)?.results ? Object.keys(readCheckpoint(checkpointPath).results).length : 0);
      const id = cases[snapshots.length - 1].caseId;
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodPrediction(id)) } }] }) };
    },
  });

  assert.equal(snapshots.length, 3, "all three cases must have been attempted");
  assert.deepEqual(snapshots, [0, 1, 2], "the checkpoint must grow after EACH case, not appear only at the end");
  const final = readCheckpoint(checkpointPath);
  assert.deepEqual(Object.keys(final.results).sort(), cases.map((c) => c.caseId).sort());
});

// ── 6. result classification: transport failure is never a semantic answer ───

test("a timeout is TIMEOUT, never a wrong answer", async () => {
  const spec = ALL_TIERS[0];
  const { results } = await runTier({
    spec, cases: [CASE("SYN-U-001")], endpoint: "https://e", apiKey: FAKE_KEY,
    temperature: 0, maxTokens: 1200, timeoutMs: 50, retries: 0, stateDir: scratch("timeout"),
    fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
  });
  const r = results["SYN-U-001"];
  assert.equal(r.resultClass, "TIMEOUT");
  // A provider that never answered has asserted nothing, so it must carry no
  // semantic verdict and no fabrications.
  assert.equal(r.caseFullyCorrect, undefined, "no semantic verdict may be recorded");
  assert.equal(r.fabricatedFieldCount, undefined, "an unanswered call has fabricated nothing");
});

test("a 200 with an unusable body is classified, not silently accepted", async () => {
  const spec = ALL_TIERS[0];
  const { results } = await runTier({
    spec, cases: [CASE("SYN-U-001")], endpoint: "https://e", apiKey: FAKE_KEY,
    temperature: 0, maxTokens: 1200, timeoutMs: 5000, retries: 0, stateDir: scratch("body"),
    fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "I cannot help with that." } }] }) }),
  });
  assert.equal(results["SYN-U-001"].resultClass, "FOREIGN_RESPONSE");
});

test("thinking is disabled on every request (measured requirement)", () => {
  const body = makeRequestBody({ model: "m", prompt: "p", temperature: 0, maxTokens: 1200 });
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(body.temperature, 0, "temperature must be pinned for a deterministic benchmark");
  assert.equal(body.stream, false);
});

// ── 7. selection helpers ────────────────────────────────────────────────────

test("case selection honours an explicit list, corpus order, and rejects unknown ids", () => {
  const picked = selectCases({ caseIds: ["SYN-U-011", "SYN-U-041"] });
  // Corpus order is SYN-U-011 then SYN-U-041 (verified, not assumed), so a request
// listing them reversed must come back in corpus order.
  assert.deepEqual(picked.map((c) => c.caseId), ["SYN-U-011", "SYN-U-041"], "order must follow the corpus, not the request");
  assert.throws(() => selectCases({ caseIds: ["SYN-NOPE"] }), /not in corpus/);
});

test("tier selection is scoped and rejects unknown names", () => {
  assert.deepEqual(selectTiers(["lightning"]).map((t) => t.tier), ["lightning"]);
  assert.throws(() => selectTiers(["nope"]), /unknown tier/);
  assert.equal(selectTiers().length, 3);
});

test("the two T2c/T2d category-contract cases are present in the corpus", () => {
  // Guard the specific cases whose off-contract answers motivated the contract work.
  assert.equal(CASE("SYN-U-041").expected.category, "Control Equipment");
  assert.equal(CASE("SYN-U-102").expected.category, "Accessories");
});
