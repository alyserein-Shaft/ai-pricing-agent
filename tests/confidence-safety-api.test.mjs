import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Task 11 routes safety evaluation before the framework and matching handlers", async () => {
  const worker = await readFile(new URL("worker/index.ts", root), "utf8");
  const safety = worker.indexOf("handleConfidenceSafetyApi(request, env)");
  assert.ok(safety > 0);
  assert.ok(safety < worker.indexOf("handleProductMatchingApi(request, env, ctx)"));
  assert.ok(safety < worker.indexOf("handler.fetch(request, env, ctx)"));
});

test("Task 11 API persists immutable decisions and enforces controlled approvals", async () => {
  const api = await readFile(new URL("worker/confidence-safety-api.mjs", root), "utf8");
  for (const required of ["INSERT INTO safety_decisions", "INSERT INTO safety_blocks", "INSERT INTO safety_warnings", "STALE_SAFETY_VERSION", "APPROVAL_ROLE_REQUIRED", "APPROVAL_BLOCKED", "WARNING_ACKNOWLEDGMENT_REQUIRED", "OVERRIDE_NOT_PERMITTED", "safety_decision_comparisons"]) assert.match(api, new RegExp(required));
  assert.match(api, /superseded_at/);
  assert.match(api, /owner_user_id/);
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
});
