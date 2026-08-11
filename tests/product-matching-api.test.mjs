import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleProductMatchingApi } from "../worker/product-matching-api.mjs";

test("matching API fails closed without configured application context", async () => {
  const response = await handleProductMatchingApi(new Request("https://local/api/boq-items/item-1/matching/status"), { DB: {} }, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
});

test("Task 10 persists immutable runs, candidates, comparisons, reviews and run comparisons", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const entity of ["productMatchRuns", "productMatchCandidates", "productMatchComparisons", "productMatchReviews", "productMatchRunComparisons"]) assert.match(schema, new RegExp(`export const ${entity}`));
  assert.match(schema, /requirementProfileVersionId/);
  assert.match(schema, /inputFingerprint/);
  assert.match(schema, /searchVersion/);
});

test("worker exposes queue, history, comparison, evidence and feedback operations", async () => {
  const [worker, index] = await Promise.all([readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8"), readFile(new URL("../worker/index.ts", import.meta.url), "utf8")]);
  for (const contract of ["start", "recalculate", "status", "candidates", "history", "compare-runs", "manual-candidate", "comparisons", "explanation", "reject", "feedback"]) assert.match(worker, new RegExp(contract));
  assert.match(worker, /resolveApplicationContext/);
  assert.doesNotMatch(worker, /oai-authenticated-user-id|x-user-id|x-user-role/);
  assert.match(worker, /approved_for_discovery=1/);
  assert.match(index, /handleProductMatchingApi/);
});

test("technical matching UI consumes persisted results and cannot approve price", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /persistentMatchCandidates/);
  assert.match(page, /Start technical matching/);
  assert.match(page, /Technical review required — no automatic approval/);
  assert.doesNotMatch(page, /Approve verified price/);
  assert.doesNotMatch(page, /Manual price[\s\S]{0,1000}Approve manual price with audit entry/);
});
