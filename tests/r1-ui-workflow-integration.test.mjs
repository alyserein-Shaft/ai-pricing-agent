// R1 UI integration -- focused tests for the three presentation defects fixed
// in this pass, plus the invariants that must survive them.
//
// Covered:
//   1. Project navigation must never render empty, and a loading workflow must
//      not be reported as "Not started".
//   2. The phase rollup must distinguish Loading / Not started / Ready /
//      Needs attention / Blocked / Failed / Stale / Complete.
//   3. A synthetic development session must never be presented as the human
//      making governed decisions, and no name may be invented for it.
//   4. A Rejected requirement must not be badged as merely "pending".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  VISIBLE_PROJECT_PHASES,
  currentVisiblePhase,
  visibleProjectPhases,
  visiblePhaseState,
} from "../app/lib/project-phase-presentation.mjs";
import { isSyntheticActor, presentActor } from "../app/lib/actor-presentation.mjs";

const WORKSPACE_SOURCE = readFileSync(
  new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1 + 2 -- Loading must not read as "Not started", and navigation is never empty
// ---------------------------------------------------------------------------

test("project navigation is populated even while the workflow is still loading", () => {
  const phases = visibleProjectPhases(null);
  assert.equal(phases.length, VISIBLE_PROJECT_PHASES.length);
  assert.ok(phases.length > 0, "navigation must never be empty");
  assert.deepEqual(
    phases.map((phase) => phase.id),
    VISIBLE_PROJECT_PHASES.map((phase) => phase.id),
    "every journey phase must be present regardless of load state",
  );
  for (const phase of phases) {
    assert.equal(typeof phase.state, "string");
    assert.ok(phase.state.length > 0, `phase ${phase.id} must always carry a state`);
    assert.equal(typeof phase.workspace, "string");
    assert.ok(phase.workspace.length > 0, `phase ${phase.id} must name a workspace to navigate to`);
  }
});

test("an unloaded workflow reads as Loading, never as Not started", () => {
  for (const phase of visibleProjectPhases(null)) {
    assert.equal(phase.state, "Loading");
    assert.notEqual(phase.state, "Not started");
  }
  assert.equal(visiblePhaseState([], { loading: true }), "Loading");
  // Loading outranks every stage status: a half-arrived payload must not
  // masquerade as a settled answer.
  assert.equal(
    visiblePhaseState([{ id: "scope", status: "Completed" }], { loading: true }),
    "Loading",
  );
});

test("a loaded workflow distinguishes Not tracked from Not started", () => {
  const arrived = { stages: [] };
  for (const phase of visibleProjectPhases(arrived)) {
    assert.notEqual(phase.state, "Loading", "an arrived workflow is no longer loading");
  }
  // A step the engine measures, with no stage present, is "Not started": a real
  // governed answer about the engineer's work.
  const measured = visibleProjectPhases(arrived).find((phase) => phase.stageIds.length > 0);
  assert.equal(measured.state, "Not started");
  // A journey step the engine does NOT measure is "Not tracked". Reporting it
  // as "Not started" would falsely claim the engineer has not done the work.
  const untracked = visibleProjectPhases(arrived).find((phase) => phase.stageIds.length === 0);
  assert.equal(untracked.state, "Not tracked");
  assert.notEqual(untracked.state, "Not started");
  // Unchanged default-argument behaviour for direct callers.
  assert.equal(visiblePhaseState([]), "Not started");
  assert.equal(visiblePhaseState([]), visiblePhaseState([], {}), "default options keep the historical answer");
  assert.equal(visiblePhaseState([{ id: "scope", status: "Not Started" }]), "Not started");
});

test("navigation population is deterministic for identical inputs", () => {
  const first = visibleProjectPhases(null).map((phase) => `${phase.id}:${phase.state}:${phase.current}`);
  const second = visibleProjectPhases(null).map((phase) => `${phase.id}:${phase.state}:${phase.current}`);
  assert.deepEqual(first, second);
  // And stable across a re-render with a freshly built but equal payload.
  const workflow = { stages: [{ id: "scope", status: "Completed", progress: 100 }], currentStageId: "scope" };
  assert.deepEqual(
    visibleProjectPhases(workflow).map((phase) => `${phase.id}:${phase.state}:${phase.current}`),
    visibleProjectPhases({ stages: [{ id: "scope", status: "Completed", progress: 100 }], currentStageId: "scope" })
      .map((phase) => `${phase.id}:${phase.state}:${phase.current}`),
  );
});

test("role or permission context cannot suppress every navigation entry", () => {
  // ProjectShell locks Costing/Quotation for a viewer; locking is per entry and
  // must never remove entries from the list itself.
  const phases = visibleProjectPhases(null);
  const locked = phases.filter((phase) => ["Costing", "Quotation"].includes(phase.workspace));
  assert.ok(locked.length > 0, "the commercial entries exist and are the lockable ones");
  assert.ok(locked.length < phases.length, "locking must not be able to suppress every entry");
  const stillReachable = phases.filter((phase) => !["Costing", "Quotation"].includes(phase.workspace));
  assert.equal(stillReachable.length, phases.length - locked.length);
  assert.ok(stillReachable.length >= 4, "the technical journey stays navigable for a commercial viewer");
  // A locked entry still names a workspace, so the select control can always
  // fall back to a real destination.
  for (const phase of locked) assert.ok(phase.workspace.length > 0);
});

test("the phase rollup distinguishes Loading, Not started, Ready, Needs attention, Blocked, Failed, Stale and Complete", () => {
  assert.equal(visiblePhaseState([{ id: "scope", status: "Ready" }]), "Ready");
  assert.equal(visiblePhaseState([{ id: "scope", status: "Needs Review" }]), "Needs attention");
  assert.equal(visiblePhaseState([{ id: "scope", status: "Blocked" }]), "Blocked");
  assert.equal(visiblePhaseState([{ id: "scope", status: "Failed" }]), "Failed");
  assert.equal(visiblePhaseState([{ id: "scope", status: "Stale" }]), "Stale");
  assert.equal(visiblePhaseState([{ id: "scope", status: "Completed" }]), "Complete");
  // Failure is reported as a failure, not as somebody else's blocker.
  assert.notEqual(visiblePhaseState([{ id: "scope", status: "Failed" }]), "Blocked");
});

test("pre-existing rollup results are unchanged by the new states", () => {
  assert.equal(
    visiblePhaseState([
      { id: "scope", status: "Completed" },
      { id: "requirements", status: "Ready" },
      { id: "technical", status: "Not Started" },
    ]),
    "In progress",
  );
  assert.equal(
    visiblePhaseState([
      { id: "scope", status: "Completed" },
      { id: "requirements", status: "Needs Review" },
      { id: "technical", status: "Not Started" },
    ]),
    "Needs attention",
  );
  // A failure still dominates a completed sibling, and a blocker still
  // dominates a failure only where the engine reports both.
  assert.equal(
    visiblePhaseState([
      { id: "scope", status: "Completed" },
      { id: "technical", status: "Failed" },
    ]),
    "Failed",
  );
});

test("the current phase is always resolvable, including while loading", () => {
  assert.ok(currentVisiblePhase(null), "a current phase must exist while loading");
  assert.equal(currentVisiblePhase(null)?.id, VISIBLE_PROJECT_PHASES[0].id);
  const workflow = {
    stages: [
      { id: "scope", status: "Completed" },
      { id: "requirements", status: "Ready" },
    ],
    currentStageId: "requirements",
  };
  assert.equal(currentVisiblePhase(workflow)?.id, "confirm-scope");
});

test("loading never reports progress", () => {
  for (const phase of visibleProjectPhases(null)) assert.equal(phase.progress, 0);
});

// ---------------------------------------------------------------------------
// 3 -- Identity presentation must not present a synthetic session as a person
// ---------------------------------------------------------------------------

test("the configured development session is recognised as synthetic", () => {
  // Exactly what `.dev.vars` configures today.
  const actor = { userId: "local-development-user", displayName: "Local Development User", email: "local@development.invalid" };
  assert.equal(isSyntheticActor(actor), true);
  const presented = presentActor(actor);
  assert.equal(presented.synthetic, true);
  assert.equal(presented.label, "Development session");
  assert.notEqual(presented.label, actor.displayName);
  assert.ok(!/Local Development User/.test(presented.label), "must not headline the synthetic name");
  assert.match(presented.attribution, /attributed to the configured human actor/);
});

test("no human name is invented for a synthetic actor", () => {
  const presented = presentActor({ userId: "local-development-user" });
  assert.equal(presented.synthetic, true);
  assert.equal(presented.label, "Development session");
  assert.equal(presented.detail, "No human actor configured");
  // No plausible human name may appear anywhere in the presented payload.
  const serialised = JSON.stringify(presented);
  assert.ok(!/Omair/i.test(serialised), "must not fabricate a human actor for a synthetic session");
});

test("a configured human actor is presented truthfully and unchanged", () => {
  const actor = { userId: "omair-primary", displayName: "Omair", email: "omair@example.com" };
  assert.equal(isSyntheticActor(actor), false);
  const presented = presentActor(actor);
  assert.equal(presented.synthetic, false);
  assert.equal(presented.label, "Omair");
  assert.equal(presented.detail, "omair@example.com");
  assert.equal(presented.attribution, "");
});

test("identity presentation does not invent role or permission semantics", () => {
  const presented = presentActor({ userId: "omair-primary", displayName: "Omair", email: "o@e.com" });
  for (const forbidden of ["role", "roles", "permission", "permissions", "administrator", "Administrator"]) {
    assert.ok(!(forbidden in presented), `presentation must not carry ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 4 -- Rejected requirements must not be badged as pending
// ---------------------------------------------------------------------------

test("a Rejected requirement is badged as blocked, never as merely pending", () => {
  const occurrences = WORKSPACE_SOURCE.match(/review_status === "Rejected" \? "review-blocked"/g) || [];
  assert.equal(occurrences.length, 2, "both the row badge and the detail badge must distinguish Rejected");
  // No remaining site may collapse every non-Approved status onto pending.
  assert.equal(
    (WORKSPACE_SOURCE.match(/review_status === "Approved" \? "review-ready" : "review-pending"/g) || []).length,
    0,
  );
});

test("the recovered Requirements features survive the integration hunk", () => {
  // Byte-for-byte recovery must not be undone by a presentation hunk.
  assert.match(WORKSPACE_SOURCE, /Source Facts/);
  assert.match(WORKSPACE_SOURCE, /Auto-confirm eligible requirements/);
  assert.match(WORKSPACE_SOURCE, /role="dialog"/);
  assert.match(WORKSPACE_SOURCE, /aria-modal="true"/);
  assert.match(WORKSPACE_SOURCE, /sourceFacts: SourceFact\[\];/);
  assert.match(WORKSPACE_SOURCE, /onAutoConfirm/);
});

// ---------------------------------------------------------------------------
// 5 -- Final journey order: Strategy before Product Selection, Engineer
//      Decision between Product Selection and Sizing
// ---------------------------------------------------------------------------

const phaseIndex = (id) => VISIBLE_PROJECT_PHASES.findIndex((phase) => phase.id === id);
const phaseById = (id) => VISIBLE_PROJECT_PHASES.find((phase) => phase.id === id);

test("the rendered journey spine declares the R1 engineer order", () => {
  assert.deepEqual(
    VISIBLE_PROJECT_PHASES.map((phase) => phase.id),
    [
      "set-up",
      "understand-tender",
      "review-boq",
      "review-understanding",
      "confirm-scope",
      "strategy",
      "select-products",
      "engineer-decision",
      "sizing",
      "bom",
      "technical-handoff",
      "build-price",
      "commercial-review",
      "review-offer",
      "issue-quotation",
    ],
    "the journey order is declared in the rendered spine, not inferred from page.tsx labels",
  );
});

test("Strategy strictly precedes Product Selection", () => {
  const strategy = phaseIndex("strategy");
  const selection = phaseIndex("select-products");
  assert.ok(strategy >= 0 && selection >= 0, "both steps must exist in the journey");
  assert.ok(
    strategy < selection,
    "a brand/standards decision taken after product selection is not a decision",
  );
  // Strategy must sit after Requirements, or it is not a strategy step at all.
  assert.ok(phaseIndex("confirm-scope") < strategy);
  assert.equal(phaseById("strategy").workspace, "Strategy");
});

test("Engineer Decision sits after Product Selection and before Sizing", () => {
  const selection = phaseIndex("select-products");
  const decision = phaseIndex("engineer-decision");
  const sizing = phaseIndex("sizing");
  assert.ok(selection < decision, "Engineer Decision must follow Product Selection");
  assert.ok(decision < sizing, "Engineer Decision must precede Sizing");
  assert.ok(sizing < phaseIndex("bom"), "Sizing must precede BOM");
});

test("every journey step the engine cannot measure says so, not Not started", () => {
  for (const id of ["review-understanding", "strategy", "engineer-decision", "sizing", "bom", "technical-handoff"]) {
    assert.deepEqual(phaseById(id).stageIds, [], `${id} has no presales stage`);
    assert.equal(visibleProjectPhases({ stages: [] }).find((phase) => phase.id === id).state, "Not tracked");
  }
  // A step the engine DOES measure must keep reporting a governed answer.
  for (const id of ["set-up", "understand-tender", "review-boq", "confirm-scope", "select-products", "build-price", "commercial-review", "review-offer", "issue-quotation"]) {
    assert.ok(phaseById(id).stageIds.length > 0, `${id} must stay bound to a real stage`);
  }
});

test("every journey stageIds entry is a stage the presales engine actually emits", () => {
  // The previous table referenced upload/classification/boq/specification/
  // matching/pricing/readiness/commercial/export, none of which the engine
  // emits, so those phases silently rolled up to "Not started".
  const declared = VISIBLE_PROJECT_PHASES.flatMap((phase) => phase.stageIds);
  assert.deepEqual(
    [...new Set(declared)].sort(),
    ["costing", "extraction", "intake", "issue", "quotation", "requirements", "scope", "selection", "setup", "supplier", "technical"],
    "phase membership must exactly cover the engine's real stage ids, with nothing invented",
  );
  // `extraction` is deliberately surfaced twice: Documents summarises the whole
  // intake-to-extraction pipeline, while BOQ is the drill-in for its review
  // debt. Both report the same governed stage, never a second opinion on it.
  assert.deepEqual(
    VISIBLE_PROJECT_PHASES.filter((phase) => phase.stageIds.includes("extraction")).map((phase) => phase.id),
    ["understand-tender", "review-boq"],
  );
});

// ---------------------------------------------------------------------------
// 6 -- The remaining R1 components are mounted, not merely written
// ---------------------------------------------------------------------------

const MATCHING_SOURCE = readFileSync(
  new URL("../app/components/workspaces/MatchingWorkspace.tsx", import.meta.url),
  "utf8",
);
const DECISION_SOURCE = readFileSync(
  new URL("../app/components/workspaces/EngineerDecisionWorkspace.tsx", import.meta.url),
  "utf8",
);
const PAGE_SOURCE = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("MatchingStagedDecision is mounted on the real matching surface", () => {
  assert.match(
    MATCHING_SOURCE,
    /import \{[^}]*RecommendedCandidateHero[^}]*AlternativesList[^}]*DecisionDimensionPanel[^}]*MatchingNextAction[^}]*\} from "\.\.\/matching\/MatchingStagedDecision"/,
    "the staged components must be imported by the matching workspace",
  );
  for (const component of ["<RecommendedCandidateHero", "<AlternativesList", "<DecisionDimensionPanel", "<MatchingNextAction"]) {
    assert.ok(MATCHING_SOURCE.includes(component), `${component} must be rendered, not just imported`);
  }
  // It must be driven by the governed presentation model, not by local state.
  assert.match(MATCHING_SOURCE, /matchingDecisionModel\(\{/);
});

test("the six decision axes are presented separately, never collapsed to one score", () => {
  const axes = ["Technical compatibility", "Contractual acceptance", "Lifecycle", "Regional availability", "Commercial availability", "Evidence confidence"];
  const LABELS_SOURCE = readFileSync(
    new URL("../app/domain/matching-decision-presentation.mjs", import.meta.url),
    "utf8",
  );
  for (const axis of axes) {
    assert.ok(LABELS_SOURCE.includes(axis), `${axis} must have its own governed dimension`);
  }
  // The staged panel must render the full dimension set.
  assert.match(
    readFileSync(new URL("../app/components/matching/MatchingStagedDecision.tsx", import.meta.url), "utf8"),
    /MATCHING_DIMENSION_LABELS/,
  );
});

test("matching consumes the governed strategy resolver output, with no hard-coded brand", () => {
  assert.match(PAGE_SOURCE, /fire-alarm\/brand-strategy/);
  assert.match(MATCHING_SOURCE, /projectStrategy\?: ProjectStrategyView/);
  // The consumer-side default must stay null so an absent strategy reads
  // NOT_EVIDENCED rather than silently passing.
  assert.match(MATCHING_SOURCE, /projectStrategy: props\.projectStrategy \?\? null/);
  for (const brand of ["Farenhyt", "Gamewell", "Honeywell", "Gent"]) {
    assert.ok(!MATCHING_SOURCE.includes(brand), `${brand} must not be hard-coded into the matching surface`);
  }
});

test("EngineerDecisionTechnical is mounted as the primary decision view", () => {
  assert.match(DECISION_SOURCE, /import \{ EngineerDecisionTechnicalView, BomAccessorySummary \} from "\.\.\/decision\/EngineerDecisionTechnical"/);
  const mount = DECISION_SOURCE.indexOf("<EngineerDecisionTechnicalView");
  assert.ok(mount > 0, "the technical view must be rendered");
  const commercial = DECISION_SOURCE.indexOf("cost.readiness.label");
  assert.ok(mount < commercial, "the technical decision must render before the commercial block");
  // The commercial block must be de-primary, not deleted: pricing mutation
  // logic belongs to another lane and is still fully functional.
  assert.match(DECISION_SOURCE, /<details className="decision-section decision-commercial-detail">/);
  assert.ok(DECISION_SOURCE.includes("decision-commercial-detail"));
});

test("the Knowledge/Admin IA is reachable and maps onto the real Agent 7 components", () => {
  assert.match(PAGE_SOURCE, /import \{ KnowledgeSectionTabs \} from "\.\/components\/knowledge\/KnowledgeSectionTabs"/);
  assert.ok(PAGE_SOURCE.includes("<KnowledgeSectionTabs"), "the IA tab bar must be rendered");
  assert.ok(PAGE_SOURCE.includes("<EngineerProductSearch"), "engineer product search must be reachable");
  assert.ok(PAGE_SOURCE.includes("<KnowledgeFactList"));
  assert.ok(PAGE_SOURCE.includes("<KnowledgeConflictList"));
  assert.ok(PAGE_SOURCE.includes("<LearningMergeView"));
  // The brief's names for the fact/conflict lists do not exist in this repo.
  assert.ok(!PAGE_SOURCE.includes("KnowledgeFactCard"), "mount the real component, not a name from the brief");
  for (const section of ["Facts", "Conflicts", "Lifecycle", "Learning", "Diagnostics"]) {
    assert.ok(PAGE_SOURCE.includes(`"${section}"`), `${section} must be routed`);
  }
});

test("Knowledge governance is not a required step of the project journey", () => {
  // Knowledge/Admin is reachable, but no project journey phase may gate the
  // engineer on entering Knowledge governance.
  for (const phase of VISIBLE_PROJECT_PHASES) {
    assert.ok(
      !/Knowledge/i.test(phase.workspace),
      `${phase.id} must not route the engineer into Knowledge governance`,
    );
  }
});