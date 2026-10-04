// Golden R11 -- drive governed system-auto-approval for every current BOQ item
// that has an AVAILABLE understanding proposal, using the SAME production row
// resolution (loadUnderstandingReviewRows) the review screen uses. The endpoint
// itself enforces the deterministic-only policy; this script never approves
// anything -- it only POSTs the per-item governed route and collects outcomes.
import { DatabaseSync } from "node:sqlite";
import { loadUnderstandingReviewRows } from "../../worker/estimator-understanding-review-api.mjs";

const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const BASE = "http://localhost:4183";
const DB = process.argv[2];

const sqlite = new DatabaseSync(DB, { readOnly: true });
const wrapper = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return {
      bind(...params) {
        return {
          all: async () => ({ results: stmt.all(...params) }),
          first: async () => stmt.get(...params) ?? null,
        };
      },
    };
  },
};

const rows = await loadUnderstandingReviewRows(wrapper, PROJECT);
console.log(`resolved ${rows.length} current rows`);

const outcomes = [];
for (const row of rows) {
  const state = row.effective?.state || "none";
  const status = row.effective?.latestCurrentAttempt?.status || null;
  const proposal = row.effective?.proposal || null;
  const reviewStatus = row.effective?.state === "AVAILABLE" ? "available" : status || "unavailable";
  if (state !== "AVAILABLE" || !proposal) {
    outcomes.push({ boqItemId: row.boqItemId, description: row.description, skipped: true, reason: `${state}/${status}` });
    continue;
  }
  const url = `${BASE}/api/boq-items/${encodeURIComponent(row.boqItemId)}/estimator-understanding-review/system-auto-approval`;
  const res = await fetch(url, { method: "POST" });
  let body = {};
  try { body = await res.json(); } catch {}
  outcomes.push({
    boqItemId: row.boqItemId,
    description: row.description,
    httpStatus: res.status,
    applied: body.applied ?? null,
    policyVersion: body.policy?.policyVersion || null,
    eligible: body.policy?.eligible ?? null,
    reasons: body.policy?.reasons || [],
    resultError: body.result?.error || null,
    error: body.error || null,
  });
}

const applied = outcomes.filter((o) => o.applied === true);
const declined = outcomes.filter((o) => o.applied === false);
const skipped = outcomes.filter((o) => o.skipped);
const other = outcomes.filter((o) => !o.skipped && o.applied === null);
console.log(`applied=${applied.length} declined=${declined.length} skipped=${skipped.length} other=${other.length}`);
console.log("--- applied ---");
for (const o of applied) console.log(`  ${o.description.slice(0, 62)}`);
console.log("--- declined reason histogram ---");
const byReason = {};
for (const o of declined) {
  const key = o.reasons.join(" | ") || "(no reasons)";
  byReason[key] = (byReason[key] || 0) + 1;
}
for (const [k, v] of Object.entries(byReason)) console.log(`  ${v}x ${k}`);
console.log("--- other (unexpected) ---");
for (const o of other.slice(0, 10)) console.log(`  ${o.httpStatus} ${o.boqItemId} ${(o.description || "").slice(0, 40)} ${JSON.stringify(o.error || o.resultError || "").slice(0, 120)}`);

import fs from "node:fs";
fs.writeFileSync(".local-evidence/golden-r11/system-auto-approval-run-1.json", JSON.stringify({ applied, declined, skipped, other, summary: { applied: applied.length, declined: declined.length, skipped: skipped.length, other: other.length } }, null, 2));
console.log("wrote .local-evidence/golden-r11/system-auto-approval-run-1.json");