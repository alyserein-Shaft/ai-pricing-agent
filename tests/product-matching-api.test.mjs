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


test("matching status reports queued processing before the first match run is persisted", async () => {
  const calls = [];

  const DB = {
    prepare(sql) {
      calls.push(sql);

      return {
        bind(...params) {
          return {
            async first() {
              if (sql.includes("FROM boq_items i JOIN projects")) {
                return {
                  id: "item-1",
                  project_id: "project-1",
                  source_document_id: "document-1",
                  source_document_version_id: "version-1",
                };
              }

              if (sql.includes("FROM product_match_runs")) {
                return null;
              }

              if (
                sql.includes("FROM document_processing_runs") &&
                sql.includes("processor_version")
              ) {
                return {
                  id: "job-1",
                  stage: "Queued",
                  status: "Queued",
                  progress: 1,
                  error_code: null,
                  error_message: null,
                };
              }

              return null;
            },

            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };

  const response = await handleProductMatchingApi(
    new Request("https://local/api/boq-items/item-1/matching/status"),
    {
      DB,
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "local-development-user",
      APP_USER_EMAIL: "local@development.invalid",
      APP_ORGANIZATION_ID: "organization_bd_shaft_internal_pilot",
    },
    { waitUntil() {} },
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "Queued");
  assert.equal(body.processing?.status, "Queued");
  assert.notEqual(body.status, "Not Started");

  assert.ok(
    calls.some((sql) =>
      /json_extract\(technical_details, '\$\.boqItemId'\)=\?/.test(sql),
    ),
    "queued matching status must be scoped to the BOQ item, not only the shared document version",
  );
});
