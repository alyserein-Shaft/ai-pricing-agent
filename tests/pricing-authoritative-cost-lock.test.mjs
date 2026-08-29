import test from "node:test";
import assert from "node:assert/strict";

import { persistRun } from "../worker/pricing-runtime.mjs";

test("persistRun locks the authoritative Full-BOM cost snapshot", async () => {
  const captured = [];
  const rows = new Map();

  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("SELECT * FROM pricing_runs WHERE scenario_id=?"))
                return null;

              if (sql.includes("SELECT r.id run_id"))
                return null;

              throw new Error(`Unexpected first() query: ${sql}`);
            },
          };
        },
      };
    },

    async batch(statements) {
      captured.push(...statements);
      return [];
    },
  };

  // Capture bound INSERT values without needing the full production schema.
  db.prepare = (sql) => ({
    bind(...args) {
      if (sql.startsWith("INSERT INTO pricing_runs")) {
        rows.set("pricingRun", { sql, args });
      }

      return {
        async first() {
          if (sql.includes("SELECT * FROM pricing_runs WHERE scenario_id=?"))
            return null;

          if (sql.includes("SELECT r.id run_id"))
            return null;

          return null;
        },
      };
    },
  });

  const input = {
    projectId: "project-1",
    productId: "product-1",
    candidateId: "candidate-1",
    quantity: 1,
    unit: "EA",
    projectCurrency: "SAR",
    versions: {
      boqItem: "v1",
      scenario: 1,
    },
    authoritativeCost: {
      readiness: "COST_READY",
      currency: "SAR",
      materialSubtotal: 43000,
      serviceSubtotal: 10000,
      totalCost: 53000,
      materialBreakdown: [
        { scope: "Primary Product", extendedCost: 30000 },
        { scope: "Required Component", extendedCost: 13000 },
      ],
    },
  };

  const result = {
    status: "Draft Price",
    approvalReady: true,
    totalCost: 53000,
    grossSelling: 66250,
    customerDiscount: 0,
    netSelling: 66250,
    vat: 0,
    finalValue: 66250,
    margin: 20,
    markup: 25,
    components: [],
    discounts: [],
  };

  await persistRun(db, {
    projectId: "project-1",
    scenario: {
      id: "scenario-1",
      version_number: 1,
    },
    boqItemId: "boq-1",
    candidateId: "candidate-1",
    input,
    result,
    userId: "user-1",
    role: "Project User",
    reason: "Commercial calculation using current Full BOM Cost",
  });

  const inserted = rows.get("pricingRun");
  assert.ok(inserted, "pricing run insert was not captured");

  // locked_versions is the 10th bound value in the pricing_runs INSERT.
  const lockedVersions = JSON.parse(inserted.args[9]);

  assert.equal(lockedVersions.boqItem, "v1");
  assert.equal(lockedVersions.scenario, 1);
  assert.equal(lockedVersions.authoritativeCost.readiness, "COST_READY");
  assert.equal(lockedVersions.authoritativeCost.currency, "SAR");
  assert.equal(lockedVersions.authoritativeCost.materialSubtotal, 43000);
  assert.equal(lockedVersions.authoritativeCost.serviceSubtotal, 10000);
  assert.equal(lockedVersions.authoritativeCost.totalCost, 53000);
});
