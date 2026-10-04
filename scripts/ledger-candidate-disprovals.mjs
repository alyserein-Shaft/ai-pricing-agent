// Settles two of the four candidates the baseline audit deliberately left
// "not seeded because not revalidated". Additive; refuses to double-write.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
if (ledger.candidate_disprovals) throw new Error("candidate_disprovals already recorded");

const now = "2026-09-27T15:45:00Z";

ledger.candidate_disprovals = {
  note:
    "coverage.not_seeded_because_not_revalidated listed four candidate issues that the baseline audit refused to seed from memory. Two of them were reachable in this session's lanes and are now settled by direct evidence -- one disproved, one confirmed-safe. The remaining two are recorded as still open, with the reason.",
  local_d1_canonical_drift: {
    verdict: "DISPROVED. The live local D1 matches the active migration chain head exactly.",
    method:
      "Read-only. The real journal-ordered drizzle-active chain was applied to a throwaway temp SQLite file and its entire sqlite_master inventory plus every column list was diffed against the live local D1, opened with a read-only handle. Nothing was applied to, adopted into, or reset on any configured binding, and the Golden project was not touched.",
    measurements_at_head_0011: {
      tables: "314 expected / 315 actual, 0 missing; the single extra is _cf_METADATA, Cloudflare's internal D1 table, not a business object",
      indexes: "457 / 457, 0 missing, 0 extra",
      views: "2 / 2, 0 missing, 0 extra",
      triggers: "43 / 43, 0 missing, 0 extra",
      columnParity: "0 mismatches across all 314 tables",
      integrity: "PRAGMA integrity_check ok",
      foreignKeys: "PRAGMA foreign_key_check 0 violations",
    },
    corroboration:
      "This independently corroborates REL-005. The database was correct at the active head the whole time; it was the REPORTED migration version that was wrong. A drifted database and a lying readiness signal are different defects with different fixes, and the probe is what distinguishes them.",
    residual: {
      severity: "P3 - a gap in assurance, not a defect in state",
      statement:
        "There is no ONGOING guard. The probe was run once, by hand, in this session. The next migration appended to the chain can leave the local D1 behind and nothing in the suite or the readiness endpoint would detect it, because readiness verifies only that 26 required TABLES are present and never compares a schema or migration version.",
      recommendation:
        "Promote this probe into a repository script and wire it to a deliberate, opt-in check rather than the unattended suite: it needs the real local D1 path, which is exactly the kind of REAL_STATE dependency the inventory excludes from the safe set. A schema-object comparison would also make the readiness endpoint's silence self-evident rather than surprising.",
      explicitly_not_done:
        "Not wired into the readiness endpoint or the suite in this slice. A schema comparison in the hot path is a design decision with operational consequences, and the concurrent writer is active in this tree.",
    },
  },
  stale_raw_quantity_fallback: {
    verdict: "DISPROVED. No silent path reintroduces a stale original quantity into governed downstream evidence.",
    method:
      "Traced every read of original_raw_values that can influence a value, then proved what the single mutating path does to downstream eligibility. Read by source inspection, not inferred from names.",
    the_only_mutating_path:
      "worker/boq-extraction-api.mjs operation 'restore' reads the original cell via source_location.cells, writes it into next[quantity], and sets reviewStatus = 'Needs Review'.",
    why_it_is_safe:
      "reviewedItemUpdateStatement (the single shared persist statement, line 317) sets approved_for_downstream = (reviewStatus === 'Approved' && rowTypeValue === 'BOQ Item') ? 1 : 0. Because restore forces 'Needs Review', a restored original quantity ALWAYS lands with approved_for_downstream = 0 and therefore cannot reach matching, pricing, costing or the BOM as approved evidence. It must be re-approved through the explicit approve operation first.",
    the_approve_path_is_also_correct:
      "The approve branch evaluates `next` -- the current reviewed values the same request is about to persist -- and never the stale original extraction snapshot. This is documented in-place as the 'BOQ Downstream-Approval Safety Fix' and enforced by boqApprovalReadiness, which refuses approval with BOQ_APPROVAL_INCOMPLETE / NON_ITEM_APPROVAL_BLOCKED.",
    corroboration:
      "The merge path goes further and explicitly forces the merged-away row to review_status='Merged', approved_for_downstream=0 in the same atomic batch, with the in-place comment recording that merge previously left an Approved item approved through a material change. So the whole mutating family invalidates downstream approval, not just restore.",
    other_reads_are_diagnostic_or_labelled:
      "app/domain/boq-review-reasons.mjs:174 reads raw values to explain review reasons; app/domain/excel-export-engine.mjs:84 populates an explicitly labelled originalDescription column; worker/review-workflow-api.mjs:160 and worker/engineering-knowledge-api.mjs:261 pass raw values through for display. None of these is a quantity authority.",
  },
  still_open: {
    quotation_export_live_data_authority:
      "ALREADY SETTLED, not open: recorded as verified invariant QUOTE-PIN-1 (lines pin candidate/pricing/approval versions and fingerprints; approve CAS-guards on evidence_fingerprint; 28/28). The baseline depth_caveat predates that verification.",
    source_fact_stale_source_promotion:
      "DELIBERATELY NOT EVALUATED BY THIS SESSION. A concurrent writer is actively working this exact territory -- worker/spec-source-fact-promotion.mjs and tests/source-fact-and-auto-confirm-authority.test.mjs were both edited within minutes of this assessment, and the latter flipped SAFE -> REAL_STATE mid-run, which is the REL-004 silent-skip class. Evaluating it now would race an active writer and produce a finding against bytes that are still moving.",
  },
};

ledger.coverage.not_seeded_because_not_revalidated = [
  "local D1 canonical drift -- SETTLED, DISPROVED at the 0011 head (0 column mismatches across 314 tables); no ongoing guard exists, recorded as candidate_disprovals.local_d1_canonical_drift.residual",
  "stale raw quantity fallback -- SETTLED, DISPROVED; the sole mutating path (restore) always revokes approved_for_downstream via reviewedItemUpdateStatement",
  "quotation/export live-data authority -- SETTLED as verified invariant QUOTE-PIN-1, 28/28; the baseline depth_caveat predates that verification",
  "Source Fact stale-source promotion -- STILL OPEN and deliberately not evaluated: it is a concurrent writer's active lane",
];

ledger.coverage.second_pass_addendum = {
  at: now,
  note:
    "Added by the recovery session. The baseline coverage caveat stands: absence of findings in an unaudited domain is not a clean bill of health. What changed is that two previously-unseeded candidates are now settled by direct evidence, one of them (local D1 drift) with a full-object-and-column comparison rather than a spot check.",
  domains_covered_in_the_recovery_session: [
    "Database / migration authority (chain, manifest, journal, snapshots, live D1 parity)",
    "Tests / release gating (inventory classification, drift gate, silent-skip detection)",
    "Production Readiness (release-gate ceiling, readiness signal correctness)",
    "Knowledge (source-revision authority revalidation against live data)",
    "BOM / panel-sizing expansion (residual dependency evaluated end to end)",
    "BOQ (stale raw quantity fallback disproved at the eligibility boundary)",
  ],
  explicitly_not_covered: [
    "The concurrent writer's Golden E2E / Overview heading lane: not touched, not reviewed, not certified here.",
    "Source Fact stale-source promotion: that writer's active lane.",
    "Every domain the baseline audit already covered remains covered by the baseline's own evidence, which this session did not re-audit.",
  ],
};

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
const after = JSON.parse(readFileSync(path, "utf8"));
console.log("local_d1_canonical_drift :", after.candidate_disprovals.local_d1_canonical_drift.verdict);
console.log("stale_raw_quantity      :", after.candidate_disprovals.stale_raw_quantity_fallback.verdict);
console.log("issues:", after.issues.length, "| not_seeded remaining:", after.coverage.not_seeded_because_not_revalidated.length);
