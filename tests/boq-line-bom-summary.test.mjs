import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectBomSummary } from "../worker/boq-line-bom-api.mjs";

const fakeDb = (rows) => ({
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes("FROM projects p")) {
              assert.deepEqual(args, ["project-1", "user-1", "user-1"]);
              return { id: "project-1" };
            }
            throw new Error(`Unexpected first() query: ${sql}`);
          },
          async all() {
            if (sql.includes("FROM (")) {
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

test("project BOM summary is ready only when every current line is BOM_READY", async () => {
  const rows = [{ id: "b1" }, { id: "b2" }, { id: "b3" }];
  const seen = [];

  const lineBomBuilder = async (_env, { itemId, userId }) => {
    seen.push([itemId, userId]);
    return {
      readiness: { state: "BOM_READY", label: "BOM ready for costing" },
      engineerQuestion: null,
    };
  };

  const result = await buildProjectBomSummary(
    { DB: fakeDb(rows) },
    { projectId: "project-1", userId: "user-1" },
    lineBomBuilder,
  );

  assert.deepEqual(seen, [
    ["b1", "user-1"],
    ["b2", "user-1"],
    ["b3", "user-1"],
  ]);

  assert.equal(result.status, "BOM_READY");
  assert.equal(result.totalLineCount, 3);
  assert.equal(result.readyLineCount, 3);
  assert.equal(result.decisionRequiredLineCount, 0);
  assert.equal(result.evidenceIncompleteLineCount, 0);
  assert.equal(result.notApplicableLineCount, 0);
  assert.deepEqual(result.unresolvedLines, []);
});

test("project BOM summary preserves decision and evidence blockers", async () => {
  const rows = [{ id: "ready" }, { id: "decision" }, { id: "missing" }, { id: "na" }];

  const lineBomBuilder = async (_env, { itemId }) => {
    if (itemId === "ready") {
      return {
        readiness: { state: "BOM_READY", label: "BOM ready for costing" },
        engineerQuestion: null,
      };
    }

    if (itemId === "decision") {
      return {
        readiness: {
          state: "BOM_DECISION_REQUIRED",
          label: "Engineer BOM decision required",
        },
        engineerQuestion: { question: "Confirm which sounder base is required." },
      };
    }

    if (itemId === "missing") {
      return {
        readiness: {
          state: "BOM_EVIDENCE_INCOMPLETE",
          label: "A required component's quantity is not yet determined",
        },
        engineerQuestion: null,
      };
    }

    return {
      readiness: {
        state: "BOM_NOT_APPLICABLE",
        label: "No approved technical decision yet",
      },
      engineerQuestion: null,
    };
  };

  const result = await buildProjectBomSummary(
    { DB: fakeDb(rows) },
    { projectId: "project-1", userId: "user-1" },
    lineBomBuilder,
  );

  assert.equal(result.status, "BOM_EVIDENCE_INCOMPLETE");
  assert.equal(result.totalLineCount, 4);
  assert.equal(result.readyLineCount, 1);
  assert.equal(result.decisionRequiredLineCount, 1);
  assert.equal(result.evidenceIncompleteLineCount, 1);
  assert.equal(result.notApplicableLineCount, 1);
  assert.equal(result.unresolvedLines.length, 3);

  assert.match(
    result.unresolvedLines.find((line) => line.boqItemId === "decision").blocker,
    /sounder base/i,
  );

  assert.match(
    result.unresolvedLines.find((line) => line.boqItemId === "missing").blocker,
    /quantity is not yet determined/i,
  );

  assert.match(
    result.unresolvedLines.find((line) => line.boqItemId === "na").blocker,
    /No approved technical decision/i,
  );
});
