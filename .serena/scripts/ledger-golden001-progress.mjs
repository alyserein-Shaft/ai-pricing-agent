// GOLDEN-001 update: takeover, the architecture stage CLEARED legitimately on the
// real Golden project, and the refined root cause for what still blocks sizing.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
const issue = ledger.issues.find((i) => i.id === "GOLDEN-001");
if (!issue) throw new Error("GOLDEN-001 missing");
if (issue.takeover) throw new Error("takeover already recorded");

const now = "2026-09-27T15:55:00Z";

issue.takeover = {
  at: "2026-09-27T15:28:20Z",
  authorised_by: "explicit operator instruction",
  ownership_evidence: {
    files_unchanged_for: "golden-full-journey.spec.ts last modified 17:55:35 (~33 min before takeover); worker/fire-alarm-panel-sizing-api.mjs 17:53:31 (~35 min)",
    only_recent_change: "scripts/ledger-golden001.mjs, written by this session at 18:25:28",
    processes: "no playwright/cli, run-golden-e2e, or d1 migrations apply process running",
    tree_fingerprint: "b8cb4f187c7dc1aa (924 files, stable)",
    file_hashes: {
      "tests/e2e/golden-full-journey.spec.ts": "898164a54dc9fb2c",
      "tests/e2e/seed-golden-catalog.sql": "b4d74b6059fbb0f6",
      "tests/e2e/seed-golden-context.sql": "73f5b6ce6aa38d07",
      "scripts/setup-golden-e2e.sh": "fdc523ccfd2e21b8",
      "worker/fire-alarm-panel-sizing-api.mjs": "c343ffa5f6cb4217",
    },
    partial_work_preserved: "no partial work discarded; no spec, fixture or source file was edited in this segment",
  },
};

issue.progress = {
  drawing_architecture_stage: {
    status: "CLEARED -- legitimately, through the production route, on the real Golden project",
    before: "drawing_architecture_approved_versions = 0; stage4 readiness = null. loadArchitecture therefore failed CURRENT_APPROVED_ARCHITECTURE_REQUIRED, which is one of the two reasons PANEL_SIZING_SNAPSHOT_REQUIRED could never clear.",
    route_used: [
      "POST /api/projects/:id/drawing-architecture/review/initialize",
      "POST /api/projects/:id/drawing-architecture/review/deterministic-confirm",
      "POST /api/projects/:id/drawing-architecture/adjudication/apply",
    ],
    basis: "real project evidence, not seeded rows. The Golden project already carried 6 Completed drawing intake versions, a non-superseded approved drawing structure version with 24 approved structure rows (H/HEAT DETECTOR, T/FIREMAN TELEPHONE JACK, S/SMOKE DETECTOR, S H/SMOKE AND HEAT COMBINED DETECTOR, ...), 39 symbol definitions, 5 recognition versions and 3 approved legend geometry versions, on legend sheet '2401232- PC- AMS- DR- T-00-ZZZ-002' which satisfies the -DR-T-* Fire Alarm discipline rule.",
    results: {
      initialize: "75 architecture facts created from 6 documents: PANEL_EXISTS 5, SLC_LOOP_EXISTS 12, PANEL_NETWORK_LINK 12, LAYOUT_LEGEND_LINK 14, PANEL_LABEL 4, INTERFACE_CONNECTED_TO_SYSTEM 12, CROSS_SHEET_REFERENCE 2, NAC_CIRCUIT_EXISTS 3, ARCHITECTURE_DISCREPANCY (remainder)",
      deterministic_confirm: "69 auto-confirmed, 6 held for engineer disposition, 0 rejected, 0 stale, 0 human-protected",
      approved_version: "approvedArchitecture_36d0565e..., version 1, status Active, approvedFactCount 69, excludedFactCount 6",
      adjudication: "6 exception records applied",
      readiness: "architecture_status=COMPLETE, stage4_readiness=READY_FOR_STAGE4_BRIDGE, unique_exception_count=4, remaining_engineer_review_required=0",
    },
    correction_to_earlier_diagnosis:
      "The earlier entry recorded that Golden 'yields 0 architecture facts', inferred from POST .../review/evaluate returning total 0. That inference was WRONG and is retracted here: /review/evaluate evaluates EXISTING review cases, of which there were none. The facts are derived by /review/initialize, which produced 75. The substance of the finding -- that no approved architecture version existed -- was correct; the stated reason was not.",
  },
  panel_sizing_stage: {
    status: "STILL BLOCKED -- next requirement identified precisely",
    probe_result: "POST /api/projects/:id/fire-alarm/panel-sizing with {panels:[],allocations:[]} -> 409 PHYSICAL_PANELS_REQUIRED 'At least one selected physical panel is required.'",
    significance:
      "This closes off the tempting shortcut. An empty panel array is NOT an escape from the gate: the production command explicitly requires at least one selected physical panel, so 'no expansion required' cannot be asserted by declaring zero panels. The snapshot must be earned from a real panel.",
    remaining_requirements_to_earn_one: [
      "a current engineering-eligible BOQ line classified as a Fire Alarm control panel, with a current selected quantity (boq_quantity_source_decisions) -- the Golden project has none recorded",
      "a current requirement profile for that line whose boqItem.productFamily classifies as control panel/equipment",
      "an Approved primary product selection and a non-stale match run for it -- the Golden project has 0 product_match_runs",
      "Approved current capacity evidence on the panel product (panel_capacity / detector_capacity / module_capacity)",
      "the two-hop Expansion Module chain AND an Approved current added_slc_loops attribute on the loop module -- added_slc_loops is absent for EVERY product in the live library (0 rows)",
      "allocation of every current SLC-pool item (detectors/modules) to a panel, per the fail-closed completeness check",
    ],
  },
};

issue.refined_root_cause = {
  statement:
    "GOLDEN-001 is not a single missing stage. It is TWO independent gaps, and the architecture half is now closed. What remains is a governed-EVIDENCE gap in the product library, not a journey gap and not a workflow gap.",
  gap_1_architecture: "CLOSED in this segment. The journey had never driven Drawing/Evidence -> Architecture; the real Golden project now has a current approved architecture version and READY_FOR_STAGE4_BRIDGE readiness.",
  gap_2_library_technical_evidence:
    "OPEN. No product in the live library carries an Approved current added_slc_loops attribute, and the Golden E2E catalog seeds no product_accessories and no product_attributes at all. The panel-sizing resolver is therefore unsatisfiable for every product, in the live library and in the hermetic fixture alike. This is the true reason PANEL_SIZING_SNAPSHOT_REQUIRED has never cleared anywhere.",
  why_not_fixed_here:
    "The user permits fixture technical evidence for the hermetic Golden catalog, and that is the correct place for it -- the Golden products (GOLDEN-FA-001 detector, GF-CP-001 panel) are fictional, so their capacity values are fixture data by construction. But seeding the hermetic catalog is only half of it: the hermetic journey project additionally has to earn a PANEL_EXISTS architecture fact from a drawing fixture, and the full drawing intake -> structure review -> publish -> architecture chain has never been exercised end to end in this repository. Every existing panel-sizing test (tests/r7-panel-sizing-production.test.mjs, r7-panel-topology-completeness, r7-topology-concurrency) hand-writes CREATE TABLE statements and hand-seeds the architecture, which is why the integration gap went unnoticed.",
  gate_integrity:
    "PANEL_SIZING_SNAPSHOT_REQUIRED was NOT relaxed, bypassed, special-cased or satisfied by an inserted row at any point. It continues to refuse correctly. PHYSICAL_PANELS_REQUIRED additionally proves the empty-panel shortcut is closed by design.",
};

issue.status_note =
  "Architecture half CLEARED with runtime evidence. Panel-sizing half remains OPEN pending governed product technical evidence (added_slc_loops + expansion chain) and, for the hermetic journey, a drawing fixture that yields a governed PANEL_EXISTS. The issue is NOT resolved: Golden E2E has not passed, and per the pass definition a unit test alone would not resolve it.";

ledger.golden_e2e_status.progress_2026_09_27T15_55Z = {
  architecture_stage: "CLEARED legitimately on the real Golden project (75 facts, approved v1 Active, READY_FOR_STAGE4_BRIDGE)",
  panel_sizing_stage: "BLOCKED at PHYSICAL_PANELS_REQUIRED; true remaining gap is absent approved added_slc_loops library evidence",
  quotation_stage: "real Golden blocked at QUOTATION_READINESS_BLOCKED: 82 unapproved requirement profiles, 82 items without eligible current prices, 82 open final estimation reviews",
  hermetic_e2e: "unchanged; still blocked at PANEL_SIZING_SNAPSHOT_REQUIRED",
  code_side_regression: "none -- this segment changed no source file; it issued governed production API calls against the designated Golden project only",
};

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
const after = JSON.parse(readFileSync(path, "utf8"));
const i = after.issues.find((x) => x.id === "GOLDEN-001");
console.log("GOLDEN-001 status:", i.status, "(architecture CLEARED, sizing OPEN)");
console.log("takeover recorded:", i.takeover.at);
