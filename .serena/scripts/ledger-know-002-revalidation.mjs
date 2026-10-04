// KNOW-002 revalidation against live data + the Part 1 build/no-build decision.
// Additive: touches only the KNOW-002 issue object. Refuses to run twice.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
const issue = ledger.issues.find((i) => i.id === "KNOW-002");
if (!issue) throw new Error("KNOW-002 missing from the ledger");
if (issue.revalidation?.revalidated_at) throw new Error("KNOW-002 already revalidated; refusing to double-write");

issue.revalidation = {
  revalidated_at: "2026-09-27T14:50:00Z",
  revalidated_against: "live local D1, opened read-only (file:...?mode=ro); no row was written and no migration was applied",
  method:
    "Direct read-only queries against .wrangler/state/v3/d1/miniflare-D1DatabaseObject, because the original finding was recorded from source only and the programme requires current-truth revalidation before acting.",
  findings: [
    "knowledge_files holds 29 rows, all in organization_bd_shaft_internal_pilot.",
    "ZERO rows share a file_name with different bytes -- this is the exact signature of a corrected re-upload, and it is the reproduction step from the original finding. It does not occur in live data.",
    "ZERO rows share a sha256 under different names.",
    "ZERO case- and whitespace-insensitive file_name collisions.",
    "PRAGMA table_info(knowledge_files) confirms there is still no family, revision, supersession or current-source column: 19 columns, unchanged.",
    "knowledge_facts is heavily populated (top source 2198 facts, then 1808, 1148, 763, 202), so the register aggregates that would double-count are genuinely live and genuinely correct today.",
  ],
  verdict:
    "LATENT CONFIRMED, NOT REOPENED. The architectural gap is real and unchanged -- the system still cannot distinguish 'a second document' from 'a corrected version of the same document' -- and it remains a real defect the moment anyone uploads a corrected file. But it is not producing wrong numbers in any live data today, and no regression guard fails. Per the programme rule, a resolved-or-latent issue is not escalated on suspicion alone.",
  part_1_decision: {
    decision: "NOT BUILT IN THIS SLICE. Specification recorded instead, ready to execute.",
    reasoning: [
      "Part 1 is provably INERT as things stand. No writer anywhere can set the successor column, because the assertion path is Part 2 and is undecided. A currentKnowledgeSources predicate threaded through the register aggregate and the five identity/promotion consumers would therefore return byte-identical results for every row in the live database, as all 29 rows would carry NULL.",
      "Its entire value is forward-looking, and its cost is not: claiming migration number 0012 in a tree with a demonstrably active concurrent migrator (0008 at 14:35, 0009 at 15:27, 0010 at 15:28, 0011 at 16:25 -- roughly a 20-50 minute cadence), and editing five live identity/pricing resolution modules. That is the same contention that caused this slice to be skipped the first time, and taking it now would risk re-creating exactly the unsettled-chain defect class (DB-002) that was repaired earlier in this same session.",
      "Shipping an inert authority and calling it progress would also overstate what is true: the authority is real, but nothing can yet exercise it, so it would be unfalsifiable plumbing rather than a governed capability.",
      "This is the programme's smallest-sufficient-fix rule applied honestly: the smallest correct next action is to make Part 1 executable on demand, not to merge unreachable code.",
    ],
    specification_ready_to_execute: {
      migration: {
        file: "drizzle-active/0012_knowledge_source_revision_authority.sql",
        number_discipline:
          "Claim 0012 only after confirming, at write time, that the chain is still settled (journal entries == .sql files == snapshots, and manifest cutoff == last journal entry). Re-verify settlement immediately after writing, and update the positive pins in tests/migration-baseline-safety.test.mjs and tests/onboarding-f-governed-scope-editing.test.mjs as part of the same change.",
        shape: [
          "ALTER TABLE `knowledge_files` ADD COLUMN `superseded_by_file_id` text REFERENCES `knowledge_files`(`id`);",
          "CREATE INDEX `knowledge_files_current_idx` ON `knowledge_files` (`organization_id`, `superseded_by_file_id`);",
        ],
        guarantees: [
          "Purely additive. No backfill, no UPDATE, no DELETE, no data write of any kind.",
          "Every existing row defaults to NULL, which means CURRENT, so no existing row changes meaning and no adoption or data repair is implied.",
          "A self-referencing FK on the same table is the whole model: succession is linear (v1 <- v2 <- v3) and 'current' is any file nothing supersedes. No families table is needed.",
        ],
        side_effects_to_handle: [
          "manifest.tables[knowledge_files].columns gains the column and manifest.counts.namedIndexes goes 457 -> 458.",
          "A 0012 Drizzle snapshot is required, and the existing gate compares every manifest column list against that snapshot, so the two must be produced together.",
        ],
      },
      authority_module: {
        intent:
          "One exported predicate used by every consumer, in the style of the existing worker/current-evidence-scope.mjs, so 'is this source current' can never be re-implemented per call site.",
        consumers_to_thread: [
          "worker/knowledge-library-api.mjs -- the Source Register aggregates (factAggregates, promotionAggregates, fileTotal) and the needs_review summary at the /api/knowledge/summary counts.",
          "worker/knowledge-promotion.mjs",
          "worker/knowledge-product-repair.mjs",
          "worker/knowledge-product-resolver-runtime.mjs",
          "worker/product-identity-api.mjs",
          "worker/supplier-price-memory.mjs",
        ],
        rule: "Succession is a RECORDED FACT and is never inferred. A newer row is NOT treated as superseding an older one, and neither is a same-named row. Inferring succession from uploaded_at ordering or from file_name equality was considered and rejected: two genuinely different documents can share a filename, so inference would silently collapse distinct sources and fabricate an authority the data does not contain -- the same error class as BOM-001's forbidden 'fabricate a product identity from calculation output'.",
      },
      honest_limit:
        "A linear chain cannot represent two independent corrections of the same source. That is a genuine ambiguity, and it must FAIL CLOSED for an operator to resolve rather than be resolved by picking the newest row.",
      tests_required: [
        "The migration is additive only: it contains no UPDATE, DELETE, TRUNCATE or INSERT, and applying it to a database built from 0000-0011 preserves every existing knowledge_files row with NULL succession.",
        "The predicate is the single authority: no consumer re-implements the currency test, asserted by source inspection across all six consumers.",
        "A superseded source's facts and review debt are excluded from the register aggregates while the source's own history stays readable.",
        "Nothing infers succession: a second file with the same name and different bytes, and a newer file with a different name, both remain CURRENT until succession is explicitly recorded.",
        "Reversal is governed: recording that a correction was wrong is an explicit act, never an inference, and never a silent re-promotion of stale evidence.",
      ],
    },
  },
  part_2_blocker: {
    status: "UNCHANGED -- blocked on a human product decision, and deliberately not invented here.",
    question:
      "Who declares that a newly uploaded Knowledge source is a CORRECTION of an existing one, and what happens when a replacement is itself wrong?",
    why_it_cannot_be_answered_from_the_repository:
      "Nothing in the code, schema, docs or tests establishes an answer. Documents have an answer by analogy (DOC-R3: document_families + document_supersessions with effective windows), but that model cannot be cloned: knowledge_files is organization-scoped with no project_id, no document_id and no foreign keys at all. Transferring it would import a project/document authority structure Knowledge does not have.",
    options_for_the_decider: [
      "Uploader nominates a predecessor at upload time (explicit, auditable, but adds a required field to the intake path).",
      "A reviewer asserts the correction after the fact from the Sources register (matches how the register's other decisions are already made, but leaves a window where both versions are live).",
      "Both, with the reviewer able to ratify or reject an upload-time nomination.",
    ],
    second_question_that_must_be_answered_together:
      "What happens when a replacement is wrong -- is the predecessor restorable, and is that restoration itself a governed, audited act? The 'honest limit' above makes this unavoidable rather than optional.",
    classification: "BUSINESS/PRODUCT POLICY. Not a code defect, not a test failure, not a migration issue. The engineering preparation is complete and waiting.",
  },
  blocking_stage_unchanged: ["PRE_PRODUCTION", "HARDENING"],
  golden_relevance_unchanged:
    "The Golden Fire Alarm journey uploads no Knowledge source and consumes no knowledge_facts, so this remains non-blocking for Golden exactly as recorded at the PRE-GOLDEN gate. That was a reasoned acceptance, not a blind waiver, and it still holds.",
};

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
const after = JSON.parse(readFileSync(path, "utf8"));
const check = after.issues.find((i) => i.id === "KNOW-002");
console.log("KNOW-002 status:", check.status, "| revalidated_at:", check.revalidation.revalidated_at);
console.log("ledger issues:", after.issues.length);
