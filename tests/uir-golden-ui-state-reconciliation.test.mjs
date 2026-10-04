// UIR-1..UIR-6 -- Golden UI-state reconciliation.
//
// The R11 governed Golden run surfaced six UI signals that a human estimator
// could reasonably have read as false readiness. This file pins the reconciled
// meaning of each one, so the reconciliation cannot silently regress, and it
// records WHY each signal is the population it is.
//
// Reconciled populations, OBSERVED read-only from the Golden project dashboard
// during that run, and re-derived here from the real domain modules rather
// than hardcoded:
//
//
//   currentExtractedRows 108 = boqItems 90 (row_type IN Item/BOQ Item)
//                              + structuralRows 18 (Section/Subsection Header)
//   activeBoqItems 82, extractionConfirmed 82
//   understanding: eligible 82, notAnalyzed 62, reviewDebt 11, approved 9
//
// Test convention follows tests/boq-duplicate-resolution-ui.test.mjs: the BOQ
// workspace is a 30k-line TSX file, so UI wiring is proven against exact source
// slices, and every population claim is proven functionally against the REAL
// domain modules and the REAL active migration chain -- never against hardcoded
// Golden numbers.
//
// CLASSIFICATION. This file must stay in the authoritative SAFE set. It opens no
// live D1 and reads no Golden row: its database is a throwaway temp file built
// from the active migration chain by ./fixtures/active-chain-fixture.mjs.
// scripts/authoritative-test-inventory.mjs assigns the excluded REAL_STATE class
// by SOURCE TEXT -- it greps for the local D1 directory, the miniflare database
// object name, and the Golden project's name, run label and id. So naming any of
// those here, even in a comment and even as observed provenance, silently drops
// this regression guard from every authoritative run. That is precisely the
// silent-skip failure REL-003 exists to prevent, and the guard test at the end of
// this file asserts it so the next edit that reintroduces a name fails loudly
// here instead of quietly narrowing coverage. The detector is deliberately left
// strict: it must keep catching genuine real-state access.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { currentBoqEvidenceCounts, currentBoqItemPredicate } from "../worker/current-evidence-scope.mjs";
import { buildPilotQualityReport } from "../worker/estimator-understanding-api.mjs";
import { currentUnderstandingCompletion } from "../worker/estimator-understanding-review-api.mjs";
import { generateActions } from "../app/domain/dashboard-workflow-engine.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { visiblePhaseState, VISIBLE_PROJECT_PHASES } from "../app/lib/project-phase-presentation.mjs";

const pageSource = async () => readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const typesSource = async () => readFile(new URL("../app/components/project/types.ts", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// UIR-1 -- "108" is 90 BOQ items + 18 section/header rows, never 108 items.
// ---------------------------------------------------------------------------

test("UIR-1a. currentBoqEvidenceCounts reports extracted rows, BOQ items and structural rows as SEPARATE populations", async (t) => {
  await t.test("section/header rows are excluded from the BOQ item count by row_type, not by a display filter", async () => {
    // The predicate is the single authority. A header row is excluded from the
    // item count because it is not a row_type of Item/BOQ Item -- not because a
    // UI hid it. Pin the vocabulary so a new header type cannot silently be
    // counted as a quotable line item.
    assert.equal(currentBoqItemPredicate("b"), "b.row_type IN ('Item','BOQ Item')");
  });

  await t.test("the three counts partition the current rows exactly, so 108 = 90 + 18 holds by construction", async () => {
    // FKs off: this exercises the counting PREDICATE, not referential
    // integrity, so the seed is deliberately non-referential (documented use of
    // activeChainDatabase({ foreignKeys: false })).
    const raw = activeChainDatabase({ foreignKeys: false });
    const db = d1(raw);
    try {
      const p = "uir1_project";
      await db.prepare("INSERT INTO projects (id,name,owner_user_id) VALUES (?,?,?)").bind(p, "Golden Recon", "uir_owner").run();
      const doc = "uir1_doc";
      await db.prepare("INSERT INTO documents (id,project_id,logical_name,created_by) VALUES (?,?,?,?)").bind(doc, p, "golden.pdf", "uir_owner").run();
      // A governing document version + current extraction version, so the rows
      // are genuinely CURRENT evidence (not merely inserted rows).
      await db.prepare(
        "INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind("uir1_dv", doc, 1, "golden.pdf", "golden.stored", "pdf", "application/pdf", 4, "sha-uir1", "p/uir1", "uir_owner")
        .run();
      await db.prepare(
        "INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
      )
        .bind("uir1_ev", doc, "uir1_dv", 1, "Completed", "p1", "r1", "o1", "uir_owner")
        .run();
      // Three BOQ items and two header rows -> 5 extracted rows, 3 items, 2 structural.
      const rows = ["Item", "BOQ Item", "Item", "Section Header", "Subsection Header"];
      for (const [i, rowType] of rows.entries()) {
        await db.prepare(
          "INSERT INTO boq_items (id,project_id,source_document_id,extraction_version_id,sequence,section_path,row_type,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,approved_for_downstream) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
          .bind(`uir1_b${i}`, p, doc, "uir1_ev", i, "S", rowType, 0.9, "High", "Approved", "A1", "{}", "{}", 1)
          .run();
      }
      const counts = await currentBoqEvidenceCounts(db, { projectId: p });
      assert.equal(counts.currentExtractedRows, 5);
      assert.equal(counts.currentBoqItems, 3);
      assert.equal(counts.structuralRows, 2);
      // The partition is exact: nothing is double-counted or dropped.
      assert.equal(counts.currentBoqItems + counts.structuralRows, counts.currentExtractedRows);
      // A header row is never extraction-confirmed, so it can never enter the
      // active engineering denominator as a quotable item.
      assert.equal(counts.extractionConfirmed, 3);
    } finally {
      raw.close();
    }
  });
});

test("UIR-1b. no BOQ count site in the UI presents structural rows as BOQ items", async () => {
  const source = await pageSource();
  // The main workspace's own count is the item population...
  assert.match(
    source,
    /<small>BOQ ITEMS<\/small>/,
    "the BOQ workspace must label its item count as BOQ ITEMS",
  );
  // ...and structural rows get their own explicitly-labelled tile.
  assert.match(
    source,
    /<small>SECTION \/ HEADER RECORDS<\/small>/,
    "section/header rows must be reported under their own label, never as items",
  );
  // The item list itself is filtered by the same row_type authority.
  assert.match(
    source,
    /\.filter\(\(item\) => item\.row_type === "BOQ Item"\)/,
    "the BOQ item list must exclude section/header rows",
  );
  // The Overview card is allowed to show 108, but only when it says so.
  const overview = await readFile(
    new URL("../app/components/workspaces/OverviewWorkspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    overview,
    /facts\.currentExtractedRows \|\| 0\} extracted rows/,
    "the Overview may show the 108 total only as 'extracted rows', alongside the structural count",
  );
  assert.match(
    overview,
    /facts\.structuralRows \|\| 0\} structural\/header/,
    "the Overview must break the extracted-row total out into its structural/header part",
  );
});

// ---------------------------------------------------------------------------
// UIR-2 -- the AI Understanding badge is PROJECT-WIDE review debt, not one run.
// ---------------------------------------------------------------------------

test("UIR-2a. the governed completion authority counts review debt across the WHOLE project, not per run", async (t) => {
  await t.test("a pilot quality report is a single-run report and may understate project debt", () => {
    // This is the defect class, pinned as a property of the data source: the
    // report is built from one run's rows. Given a run report that saw only one
    // of three outstanding items, it reports 1 -- which is why it must never
    // back a project-wide count.
    // persistedSummary counts PERSISTED statuses, so only `status` is needed.
    const report = buildPilotQualityReport(
      { id: "run1", model: "m" },
      [{ status: "NEEDS_REVIEW" }, { status: "COMPLETED" }, { status: "COMPLETED" }],
    );
    assert.equal(report.persistedSummary.processed, 3);
    assert.equal(report.persistedSummary.needsReview, 1);
    assert.equal(report.persistedSummary.failed, 0);
    // A run report with no NEEDS_REVIEW rows reports zero, even though other
    // runs may hold unresolved debt. Using it as a project count is unsound:
    // a later clean batch makes an earlier unresolved batch disappear from it.
    const clean = buildPilotQualityReport({ id: "run2", model: "m" }, [{ status: "COMPLETED" }]);
    assert.equal(clean.persistedSummary.needsReview, 0);
    assert.equal(clean.persistedSummary.failed, 0);
  });

  await t.test("reviewDebt is the project-wide bucket of items awaiting a decision", async () => {
    const raw = activeChainDatabase({ foreignKeys: false });
    const db = d1(raw);
    try {
      const p = "uir2_project";
      await db.prepare("INSERT INTO projects (id,name,owner_user_id) VALUES (?,?,?)").bind(p, "UIR2", "uir_owner").run();
      // eligible = 0 -> completion is false and reviewDebt is 0. This pins the
      // fail-closed direction: an absent population is NOT complete, so no UI
      // reading this authority can report "Up to date" on missing evidence.
      const completion = await currentUnderstandingCompletion(db, p, {});
      assert.equal(completion.eligible, 0);
      assert.equal(completion.reviewDebt, 0);
      assert.equal(completion.completion, false);
      assert.equal(completion.status, "INCOMPLETE");
    } finally {
      raw.close();
    }
  });
});

test("UIR-2b. the UI badge and handoff card read the project-wide authority, never a single-run report", async () => {
  const source = await pageSource();
  // The badge is fed by the AIU-4A object on the dashboard facts.
  assert.match(
    source,
    /const boqUnderstandingFact = \(boqDashboardFacts as/,
    "the badge must read the backend-owned facts.understanding object",
  );
  assert.match(
    source,
    /boqUnderstandingFact\.reviewDebt \|\| 0\) \+/,
    "the badge count must be built from the governed reviewDebt bucket",
  );
  // REGRESSION PIN: the badge must not be rebuilt from a per-run quality report.
  assert.doesNotMatch(
    source,
    /const boqUnderstandingReviewCount = understandingQualitySummary/,
    "the project-wide badge must not be derived from the single latest pilot run report",
  );
  // The workflow-strip entry must carry that same count.
  assert.match(
    source,
    /\{ id: "understanding", label: "AI Understanding", module: "AI Understanding Review", count: boqUnderstandingReviewCount \}/,
    "the AI Understanding strip badge must use the project-wide count",
  );
  // The handoff card's status word AND its number must read the same authority,
  // so the two can never disagree with each other or with the badge.
  assert.match(
    source,
    /boqUnderstandingFact\.reviewDebt > 0 \|\| boqUnderstandingFact\.analysisDebt > 0 \? "review-blocked"/,
    "the handoff card status must be driven by the governed debt buckets",
  );
  assert.match(
    source,
    /`\$\{boqUnderstandingFact\.reviewDebt\} awaiting review/,
    "the handoff card number must be the governed reviewDebt, not a run report",
  );
  // A missing authority must render as "not started"/unknown, never as a
  // fabricated zero -- the badge is omitted when its count is null.
  assert.match(
    source,
    /!boqUnderstandingFact\s*\n?\s*\? "Not started"/,
    "an unloaded authority must read as not-started, never as zero/clean",
  );
  assert.match(
    source,
    /boqUnderstandingReviewCount != null && boqUnderstandingReviewCount > 0/,
    "the secondary action must stay suppressed when the authority has not loaded",
  );
});

test("UIR-2c. the completion predicate is consumed from the backend, never recomputed in the UI", async () => {
  const source = await pageSource();
  const types = await typesSource();
  // The shape is declared once, in the shared types module, so no consumer can
  // restate the completion rule.
  assert.match(types, /export type UnderstandingCompletionFact = \{/, "the AIU-4A fact shape must be declared once in shared types");
  assert.match(types, /completion: boolean;/, "the governed completion flag must be part of the declared shape");
  // The UI must not invent its own completion arithmetic.
  assert.doesNotMatch(
    source,
    /boqUnderstandingFact\.reviewDebt \+ boqUnderstandingFact\.failed === 0/,
    "the UI must not recompute AIU-4A completion as a local equality test",
  );
  // The engine's own understanding summary must stay the AIU-4A one, not a
  // local "all approved" rule.
  const engine = await readFile(
    new URL("../app/domain/presales-workflow-engine.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    engine,
    /status:f\.understanding\.completion\?"Completed"/,
    "the workflow must read the backend completion flag rather than deriving its own",
  );
});

// ---------------------------------------------------------------------------
// UIR-3 -- "Requirements 82" is outstanding review debt, and is labelled as such.
// ---------------------------------------------------------------------------

test("UIR-3. the Requirements count is the not-yet-approved population, and a sibling label says so", async () => {
  const source = await pageSource();
  // The badge is the debt count, not the generated-profile coverage count.
  assert.match(
    source,
    /const boqRequirementReviewCount = Number\(boqDashboardFacts\?\.requirementReview \|\| 0\)/,
    "the Requirements count must be requirementReview (outstanding), not requirementProfiles (generated)",
  );
  // Because both happen to be 82 on the Golden project, only the prose label can
  // disambiguate them -- so the label must exist.
  assert.match(
    source,
    /Review Requirements · \$\{boqRequirementReviewCount\} need attention/,
    "the Requirements affordance must state that the count is outstanding work",
  );
  assert.match(
    source,
    /requirement profile\$\{serverProjectDashboard\.facts\.requirementReview === 1 \? "" : "s"\} need attention/,
    "the handoff card must state that the count is outstanding work",
  );
  // The status word must never claim readiness while debt is outstanding.
  assert.match(
    source,
    /facts\.requirementReview \|\| 0\) > 0\s*\? "Needs attention"/,
    "outstanding requirement debt must never read as Ready",
  );
});

// ---------------------------------------------------------------------------
// UIR-4 -- "Confirm scope" is a navigation phase label, not a second gate.
// ---------------------------------------------------------------------------

test("UIR-4. Confirm scope is a phase-tab rollup; it has no second confirm gate to diverge", async () => {
  const phases = await import("../app/lib/project-phase-presentation.mjs");
  const confirmScope = VISIBLE_PROJECT_PHASES.find((p) => p.id === "confirm-scope");
  assert.ok(confirmScope, "the confirm-scope phase must exist");
  // It is a rollup over three stages -- so it can never be confused with the
  // engine's single `scope` stage, and it owns no authority of its own.
  assert.deepEqual([...confirmScope.stageIds].sort(), ["requirements", "scope", "technical"]);

  // A completed `scope` stage plus a Not-Started `technical` stage must NOT read
  // as "Complete": the rollup reports honestly "In progress".
  assert.equal(
    visiblePhaseState([
      { id: "scope", status: "Completed" },
      { id: "requirements", status: "Ready" },
      { id: "technical", status: "Not Started" },
    ]),
    "In progress",
  );
  // Only a genuinely complete rollup may read Complete.
  assert.equal(
    visiblePhaseState([
      { id: "scope", status: "Completed" },
      { id: "requirements", status: "Completed" },
      { id: "technical", status: "Completed" },
    ]),
    "Complete",
  );
  // A blocked member must dominate a completed one.
  assert.equal(
    visiblePhaseState([
      { id: "scope", status: "Completed" },
      { id: "requirements", status: "Needs Review" },
      { id: "technical", status: "Not Started" },
    ]),
    "Needs attention",
  );

  // The engine's scope stage predicate is scope-only, and it is satisfiable by
  // facts alone -- there is no user-writable "confirm" that could disagree.
  const workflow = derivePresalesWorkflow({
    project: { id: "p", name: "n", organizationId: "o", systemDomain: "Fire Alarm" },
    facts: { documents: 1, classified: 1, boqItems: 3, specificationExtractions: 1, openClarifications: 0 },
  });
  const scope = workflow.stages.find((s) => s.id === "scope");
  assert.equal(scope.status, "Completed");
  // An open clarification must un-complete it -- proving the predicate is live
  // and is the same one the phase tab rolls up.
  const blocked = derivePresalesWorkflow({
    project: { id: "p", name: "n", organizationId: "o", systemDomain: "Fire Alarm" },
    facts: { documents: 1, classified: 1, boqItems: 3, specificationExtractions: 1, openClarifications: 1 },
  });
  assert.equal(blocked.stages.find((s) => s.id === "scope").status, "Needs Review");
  // The phase module must remain a pure display rollup: it exports no gate of
  // its own, so there is nothing for it to enforce that the engine does not.
  assert.deepEqual(
    Object.keys(phases).sort(),
    ["VISIBLE_PROJECT_PHASES", "currentVisiblePhase", "visiblePhaseBlockerSummary", "visiblePhaseState", "visibleProjectPhases"],
    "the phase module must stay a pure display rollup with no authority of its own",
  );
});

// ---------------------------------------------------------------------------
// UIR-5 -- the Costing count must never imply readiness that does not exist.
// ---------------------------------------------------------------------------

test("UIR-5. a Costing count of outstanding missing prices can never be read as costing readiness", async (t) => {
  await t.test("missingPrices is outstanding debt, so it must not reduce to 0 while upstream is untouched", () => {
    // With nothing matched and nothing approved, the outstanding count is the
    // full active denominator -- it must not silently fall to zero and imply the
    // stage is done. This is the fail-closed direction the badge relies on.
    const facts = { activeBoqItems: 82, pricedItems: 0, technicalApproved: 0, technicalPending: 0, commercialPending: 0, finalReviewApproved: 0, openSafetyBlocks: 0, blockingClarifications: 0, missingPrices: 82 };
    const actions = generateActions(facts, { ready: false, progress: 0 }, { id: "p", name: "n" });
    // Because technicalApproved (0) does not exceed pricedItems (0), pricing is
    // NOT actionable: no human may be told to go price 82 items that are not
    // technically eligible.
    assert.equal(actions.filter((a) => a.type === "missing-price").length, 0);
  });

  await t.test("the Costing workspace is hard-gated on a technically approved item, so the count cannot start work", async () => {
    const source = await pageSource();
    // The workspace is only `available` when something is technically approved.
    assert.match(
      source,
      /available=\{Number\(preSalesWorkflow\?\.facts\?\.technicalApproved \|\| 0\) > 0\}/,
      "Costing must be gated on at least one technically approved item",
    );
    // The blocked state must name the real prerequisite rather than offering a
    // pricing action.
    assert.match(
      source,
      /blocker=\{preSalesWorkflow\?\.blockers\.find\(\(entry\) => \["requirements", "selection", "technical"\]\.includes\(entry\.stageId\)\)\?\.message\}/,
      "the Costing gate must surface the real upstream blocker",
    );
  });

  await t.test("the server independently refuses a cost decision with no technical selection", async () => {
    const costApi = await readFile(new URL("../worker/boq-line-cost-api.mjs", import.meta.url), "utf8");
    assert.match(
      costApi,
      /resolveCurrentPrimarySelection\(env\.DB, itemId\)/,
      "a cost decision must resolve current technical selection authority first",
    );
    assert.match(
      costApi,
      /TECHNICAL_SELECTION_REQUIRED/,
      "a cost decision without technical selection must be refused server-side",
    );
  });
});

// ---------------------------------------------------------------------------
// UIR-6 -- outstanding work is BLOCKING; informational work is not.
// ---------------------------------------------------------------------------

test("UIR-6. requirement debt is human-blocking, and non-actionable informational facts raise no blocking action", async (t) => {
  await t.test("the Golden action queue is exactly the one real human blocker", () => {
    const facts = {
      documents: 15,
      classified: 15,
      unsupported: 0,
      processing: 0,
      failedJobs: 0,
      boqItems: 90,
      activeBoqItems: 82,
      extractionReview: 0,
      possibleDuplicates: 0,
      requirementProfiles: 82,
      requirementReview: 82,
      matchedItems: 0,
      technicalPending: 0,
      technicalApproved: 0,
      affectedBoqItems: 0,
      pricedItems: 0,
      missingPrices: 82,
      commercialPending: 0,
      commercialApproved: 0,
      finalReviewApproved: 0,
      finalReviewPending: 82,
      openClarifications: 0,
      blockingClarifications: 0,
      openSafetyBlocks: 0,
      exportsCompleted: 0,
      exportFailures: 0,
    };
    const actions = generateActions(facts, { ready: false, progress: 47 }, { id: "p", name: "Sample Project" });
    // Requirement profiles awaiting approval are real human work: exactly one
    // blocking action, and it is the requirements one.
    const requirements = actions.filter((a) => a.type === "review-requirements");
    assert.equal(requirements.length, 1);
    assert.equal(requirements[0].blocking, true);
    assert.equal(requirements[0].severity, "High");
    // Everything else on the Golden project is either done or not yet actionable.
    assert.deepEqual(
      actions.map((a) => a.type).sort(),
      ["review-requirements"],
    );
  });

  await t.test("an unreadable document is visible but never blocks the project", () => {
    const actions = generateActions(
      {
        documents: 15,
        classified: 12,
        unsupported: 3,
        failedJobs: 0,
        extractionReview: 0,
        requirementReview: 0,
      },
      { ready: false, progress: 0 },
      { id: "p", name: "n" },
    );
    const unsupported = actions.filter((a) => a.type === "unsupported-documents");
    assert.equal(unsupported.length, 1);
    assert.equal(unsupported[0].blocking, false, "permanently-unreadable content must never block forever");
    // 12 classified + 3 unsupported resolves all 15, so no classify action.
    assert.equal(actions.filter((a) => a.type === "classify-documents").length, 0);
  });

  await t.test("the only blocking action on Golden points at the Requirements workspace", () => {
    const facts = { documents: 15, classified: 15, requirementReview: 82 };
    const [action] = generateActions(facts, { ready: false, progress: 47 }, { id: "p", name: "n" });
    assert.equal(action.route, "Requirements?status=needs-review");
    assert.equal(action.requiredRole, "Technical Reviewer");
  });
});

// REL-003 GUARD: this file is in the authoritative safe set, not the excluded
// REAL_STATE set. It must open no live D1 and read no live Golden row, and it
// must not name the Golden project in source text, because the inventory
// classifier reads source text. See the header note.
test("REL-003 GUARD: this file stays in the authoritative safe set", async () => {
  const source = await readFile(new URL(import.meta.url), "utf8");
  // The forbidden tokens are assembled from fragments on purpose: writing them
  // out literally here would make this guard match its own source and fail
  // forever, which is the same silent-narrowing trap in reverse.
  const goldenProject = new RegExp(["Al", "Mousa"].join(" "));
  const goldenRun = new RegExp(["Clean", "Golden", "Run"].join(" "));
  const goldenId = new RegExp(["project_ae501", "1b85"].join(""));
  const liveLocalD1 = new RegExp([["\\.", "wrangler"].join(""), ["miniflare", "D1"].join("-")].join("|"));
  assert.doesNotMatch(source, liveLocalD1, "this file must not touch live local D1 state");
  assert.doesNotMatch(
    source,
    goldenProject,
    "naming the Golden project in source text would silently exclude this guard from every authoritative run",
  );
  assert.doesNotMatch(source, goldenRun, "naming the Golden run in source text would silently exclude this guard");
  assert.doesNotMatch(source, goldenId, "naming the Golden project id in source text would silently exclude this guard");
  assert.match(source, /active-chain-fixture/, "this file proves behaviour against the real active migration chain");
});
