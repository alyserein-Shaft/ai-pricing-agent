// R11 Mission 1 -- exact Understanding approval lifecycle ledger.
// Uses the PRODUCTION row resolver so current-authority status is computed by
// the same code the review screen and downstream engines use.
import { DatabaseSync } from "node:sqlite";
import { loadUnderstandingReviewRows } from "../../worker/estimator-understanding-review-api.mjs";

const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
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

// --- raw event history from the authoritative audit table ---
const evRows = await wrapper.prepare(`
  SELECT e.boq_item_id, e.action, e.previous_status, e.new_status, e.reason, e.actor_user_id,
         e.request_id, e.created_at, e.interpretation_id, e.review_version_id
  FROM estimator_understanding_review_events e
  WHERE e.project_id=? ORDER BY e.created_at, e.id`).bind(PROJECT).all();
const events = evRows.results;

// --- review version rows ---
const rvRows = await wrapper.prepare(`
  SELECT boq_item_id, version_number, review_status, source_input_fingerprint, interpretation_id, created_at
  FROM estimator_understanding_review_versions WHERE project_id=? ORDER BY boq_item_id, version_number`).bind(PROJECT).all();
const rvByItem = new Map();
for (const r of rvRows.results) {
  if (!rvByItem.has(r.boq_item_id)) rvByItem.set(r.boq_item_id, []);
  rvByItem.get(r.boq_item_id).push(r);
}

// --- current effective state per item (production resolver) ---
const rows = await loadUnderstandingReviewRows(wrapper, PROJECT);
const curByItem = new Map(rows.map((r) => [r.boqItemId, r]));

const ledger = rows.map((r) => {
  const itemEvents = events.filter((e) => e.boq_item_id === r.boqItemId);
  const approvals = itemEvents.filter((e) => e.new_status === "APPROVED");
  const firstApproval = approvals[0] || null;
  const reApprovals = approvals.filter((e) => e.previous_status === "APPROVED");
  const rv = (rvByItem.get(r.boqItemId) || []);
  const latestRv = rv.length ? rv[rv.length - 1] : null;
  const reviewMatchesEffective = Boolean(
    r.reviewVersionId && r.interpretationId &&
    r.reviewInterpretationId === r.interpretationId &&
    r.reviewInputFingerprint === r.effective?.currentInputFingerprint
  );
  // current authority = only an APPROVED review that still matches the current effective interpretation
  const currentAuthority = r.reviewStatus === "APPROVED" && reviewMatchesEffective;
  return {
    boqItemId: r.boqItemId,
    description: r.description,
    effectiveState: r.effective?.state || "none",
    currentInterpretationId: r.interpretationId,
    currentInputFingerprint: r.effective?.currentInputFingerprint || null,
    interpretationCount: rv.length,
    approvalEventCount: approvals.length,
    firstApprovalAt: firstApproval?.created_at || null,
    reApprovalCount: reApprovals.length,
    latestReviewVersion: latestRv?.version_number ?? null,
    latestReviewStatus: latestRv?.review_status ?? null,
    latestReviewInterpretationId: latestRv?.interpretation_id ?? null,
    reviewMatchesEffective,
    currentAuthority,
    reportedStatus: r.reviewStatus,
  };
});

const approvedEver = ledger.filter((l) => l.approvalEventCount > 0);
const currentAuthority = ledger.filter((l) => l.currentAuthority);
const staleApproved = ledger.filter((l) => l.approvalEventCount > 0 && l.latestReviewStatus === "APPROVED" && !l.currentAuthority);
const awaiting = ledger.filter((l) => l.reportedStatus === "AWAITING_REVIEW");
const notAnalyzed = ledger.filter((l) => l.reportedStatus === "NOT_ANALYZED");
const revalidation = ledger.filter((l) => l.reportedStatus === "REVALIDATION_REQUIRED");

console.log("=== LEDGER SUMMARY ===");
console.log("TOTAL_APPROVAL_ACTIONS(events)      :", events.filter(e=>e.new_status==='APPROVED').length);
console.log("TOTAL_REVIEW_EVENTS(all actions)    :", events.length);
console.log("UNIQUE_ITEMS_EVER_AUTO_APPROVED     :", approvedEver.length);
console.log("  of which re-approved (APPROVED->APPROVED):", ledger.reduce((n,l)=>n+l.reApprovalCount,0));
console.log("CURRENT_APPROVED (authority)        :", currentAuthority.length);
console.log("STALE_APPROVED (version APPROVED, authority stale):", staleApproved.length);
console.log("CURRENT_AWAITING_REVIEW             :", awaiting.length);
console.log("REVALIDATION_REQUIRED               :", revalidation.length);
console.log("NOT_ANALYZED                        :", notAnalyzed.length);
console.log("MATH: everApproved("+approvedEver.length+") - staleApproved("+staleApproved.length+") = currentAuthority("+currentAuthority.length+")  ->", approvedEver.length - staleApproved.length === currentAuthority.length ? "RECONCILES" : "MISMATCH");

console.log("\n=== STALE APPROVALS (approval record exists but no longer matches current interpretation) ===");
for (const l of staleApproved) console.log(`  v${l.latestReviewVersion} ${l.description.slice(0,44)} | appEvents=${l.approvalEventCount} reApp=${l.reApprovalCount} effState=${l.effectiveState} reported=${l.reportedStatus}`);

console.log("\n=== CURRENT AUTHORITY (12) ===");
for (const l of currentAuthority) console.log(`  v${l.latestReviewVersion} ${l.description.slice(0,44)} | appEvents=${l.approvalEventCount} reApp=${l.reApprovalCount}`);

import fs from "node:fs";
fs.mkdirSync(".local-evidence/golden-r11", { recursive: true });
fs.writeFileSync(".local-evidence/golden-r11/m1-approval-ledger.json", JSON.stringify({ ledger, events }, null, 2));
console.log("\nwrote .local-evidence/golden-r11/m1-approval-ledger.json");