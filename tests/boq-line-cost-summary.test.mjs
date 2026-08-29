import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildProjectCostSummary } from "../worker/boq-line-cost-api.mjs";

const fakeDb = (rows) => ({
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes("SELECT id FROM projects")) {
              assert.deepEqual(args, ["project-1", "user-1"]);
              return { id: "project-1" };
            }
            throw new Error(`Unexpected first() query: ${sql}`);
          },
          async all() {
            if (sql.includes("FROM boq_items b")) {
              assert.deepEqual(args, ["project-1"]);
              return { results: rows };
            }
            throw new Error(`Unexpected all() query: ${sql}`);
          },
        };
      },
    };
  },
});

test("project cost summary rolls up the same Full BOM line-cost model", async () => {
  const rows = [
    { id: "b1", system: "Fire Alarm" },
    { id: "b2", system: "Fire Alarm" },
    { id: "b3", system: "CCTV" },
  ];

  const costs = new Map([
    ["b1", 150],
    ["b2", 50.25],
    ["b3", 99.75],
  ]);

  const seen = [];
  const lineCostBuilder = async (_env, { itemId, userId }) => {
    seen.push([itemId, userId]);
    return {
      summary: { currency: "SAR", totalCost: costs.get(itemId) },
      readiness: { state: "COST_READY" },
    };
  };

  const result = await buildProjectCostSummary(
    { DB: fakeDb(rows) },
    { projectId: "project-1", userId: "user-1" },
    lineCostBuilder,
  );

  assert.deepEqual(seen, [
    ["b1", "user-1"],
    ["b2", "user-1"],
    ["b3", "user-1"],
  ]);
  assert.equal(result.status, "COST_READY");
  assert.equal(result.knownCostSubtotal, 300);
  assert.equal(result.projectTotalCost, 300);
  assert.equal(result.completeLineCount, 3);
  assert.equal(result.incompleteLineCount, 0);
  assert.equal(result.totalLineCount, 3);
  assert.deepEqual(result.systems, [
    { system: "Fire Alarm", totalCost: 200.25, completeLineCount: 2 },
    { system: "CCTV", totalCost: 99.75, completeLineCount: 1 },
  ]);
});

test("one incomplete costable line makes project total null instead of silently partial", async () => {
  const rows = [
    { id: "priced", system: "Fire Alarm" },
    { id: "missing", system: "Fire Alarm" },
  ];

  const lineCostBuilder = async (_env, { itemId }) => {
    if (itemId === "priced") {
      return {
        summary: { currency: "SAR", totalCost: 125 },
        readiness: { state: "COST_READY" },
      };
    }
    return {
      summary: { currency: "SAR", totalCost: null },
      readiness: { state: "COST_EVIDENCE_INCOMPLETE" },
      currentBlocker: "Required base B501-IV has no selected current price evidence.",
    };
  };

  const result = await buildProjectCostSummary(
    { DB: fakeDb(rows) },
    { projectId: "project-1", userId: "user-1" },
    lineCostBuilder,
  );

  assert.equal(result.status, "COST_EVIDENCE_INCOMPLETE");
  assert.equal(result.knownCostSubtotal, 125);
  assert.equal(result.projectTotalCost, null);
  assert.equal(result.completeLineCount, 1);
  assert.equal(result.incompleteLineCount, 1);
  assert.equal(result.totalLineCount, 2);
  assert.equal(result.incompleteLines[0].boqItemId, "missing");
  assert.match(result.incompleteLines[0].blocker, /B501-IV/);
});

test("project cost summary source is restricted to current downstream-approved BOQ items", async () => {
  const source = await readFile(
    new URL("../worker/boq-line-cost-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /b\.row_type='BOQ Item'/);
  assert.match(source, /b\.approved_for_downstream=1/);
  assert.match(source, /d\.current_version_id=e\.document_version_id/);
  assert.match(source, /e\.superseded_at IS NULL/);
  assert.match(source, /e\.status IN \('Completed','Needs Review'\)/);
});
