// DRY RUN — READ-ONLY. Evaluates the REAL production policy for every current
// Golden BOQ item and reports exactly which are eligible for system
// auto-approval, with the precise disqualifying reasons. Performs NO mutation.
import { DatabaseSync } from "node:sqlite";
import {
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
} from "../worker/estimator-understanding-review-api.mjs";
import { evaluateUnderstandingSystemAutoApproval } from "../app/domain/understanding-system-auto-approval.mjs";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const raw = new DatabaseSync(DB, { readOnly: true });
// The policy readers only ever SELECT. Wrap in the same minimal adapter shape
// the worker uses so no write method is reachable from this script at all.
const db = {
  prepare(sql) {
    let vals = [];
    const s = raw.prepare(sql);
    const stmt = {
      bind(...v) {
        vals = v;
        return stmt;
      },
      first: async () => s.get(...vals) ?? null,
      all: async () => ({ results: s.all(...vals) }),
      run: async () => {
        throw new Error("READ-ONLY DRY RUN: run() is not permitted in this script");
      },
    };
    return stmt;
  },
  batch: async () => {
    throw new Error("READ-ONLY DRY RUN: batch() is not permitted in this script");
  },
};

const rows = await loadUnderstandingReviewRows(db, P);
const eligible = [];
const blocked = [];

for (const row of rows) {
  const item = safeUnderstandingReviewItem(row);
  const policy = evaluateUnderstandingSystemAutoApproval({
    rawDescription: row.description,
    boqItemSystemValue: row.sourceSystem,
    interpretation: row.effective?.proposal || null,
    proposalState: item.proposalState,
    classificationBlockers: item.classificationBlockers,
    taxonomyValid: Boolean(item.familyClassification?.governedTaxonomyAccepted),
  });
  const rec = {
    boqItemId: row.boqItemId,
    description: row.description,
    family: row.effective?.proposal?.productFamily?.value ?? null,
    eligible: policy.eligible,
    reasons: policy.reasons,
  };
  (policy.eligible ? eligible : blocked).push(rec);
}

console.log("=== DRY RUN: real production policy, zero mutation ===");
console.log("items evaluated        :", rows.length);
console.log("ELIGIBLE for approval  :", eligible.length);
console.log("BLOCKED                :", blocked.length);
console.log();

console.log("--- ELIGIBLE ---");
for (const e of eligible) {
  console.log(`  ${e.family.padEnd(30)} ${e.description.slice(0, 60)}`);
}
console.log();

const groups = new Map();
for (const b of blocked) {
  const key = b.reasons.filter((r) => r !== "PRODUCT_FAMILY_DETERMINISTICALLY_REPRODUCED_FROM_RAW_TEXT").join(",") || "(none)";
  groups.set(key, (groups.get(key) || 0) + 1);
}
console.log("--- BLOCKED, grouped by reason set ---");
[...groups.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  x${String(v).padStart(3)}  ${k}`));
