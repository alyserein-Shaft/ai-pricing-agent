// GOLDEN-001 -- Golden E2E is blocked at the Quotation stage on governed Fire
// Alarm panel sizing. Full requirement chain characterised from source and from a
// real run. This is the diagnosis the concurrent Golden lane needs; it is not a
// re-implementation of their work.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
if (ledger.issues.some((i) => i.id === "GOLDEN-001")) throw new Error("GOLDEN-001 already present");
if (ledger.golden_e2e_status) throw new Error("golden_e2e_status already recorded");

const now = "2026-09-27T16:35:00Z";
const BASELINE = ledger.baseline.id;

ledger.issues.push({
  id: "GOLDEN-001",
  title: "Golden E2E cannot reach Quotation: no governed Fire Alarm panel-sizing snapshot can be created",
  domain: "Golden E2E / Fire Alarm",
  severity: "P1 - blocks the Golden journey at the Quotation stage; the quotation gate is working correctly",
  status: "OPEN",
  issue_class: "JOURNEY_EVIDENCE_GAP",
  summary:
    "The Golden full-journey spec drives matching, technical approval, safety approval, pricing, pricing-run approval and the final commercial review successfully, and the presales workflow reports readyForQuotation = true. The quotation draft is then refused by the SECOND, stricter gate in the same handler: loadCanonicalQuotationLines raises the project-level blocker PANEL_SIZING_SNAPSHOT_REQUIRED. No Fire Alarm project -- Golden, the historical project, or any other -- has ever had a fire_alarm_panel_sizing_snapshots row, so this gate has never been cleared anywhere in this environment. Reaching Quotation therefore requires driving governed panel sizing, which in turn requires the Drawing/Evidence -> Architecture stage that the current journey does not perform.",
  this_is_not_a_defect_in_the_gate:
    "PANEL_SIZING_SNAPSHOT_REQUIRED is BOM-001's fail-closed gate and it is behaving exactly as designed and as its 7/7 regression guard specifies. The gate is not weakened, bypassed or special-cased here. The gap is that the journey never supplies the evidence the gate correctly demands.",
  evidence: [
    {
      type: "RUNTIME",
      path: "npm run test:e2e:golden (run by this session, tree stable at fingerprint 739c9f4374ad6122)",
      symbol: "golden-full-journey.spec.ts:464",
      observation:
        "POST /api/projects/<id>/presales-workflow/quotation/draft returned 409 {\"code\":\"QUOTATION_LINE_AUTHORITY_BLOCKED\",\"message\":\"Every current BOQ item must have canonical commercially approved pricing before a quotation draft can be created.\",\"blockers\":[\"PANEL_SIZING_SNAPSHOT_REQUIRED\"]}. The message is generic; the blocker list names the real cause. The pricing chain was NOT the problem.",
    },
    {
      type: "SEMANTIC",
      path: "worker/presales-workflow-api.mjs",
      symbol: "handlePresalesWorkflowApi, operation quotation/draft",
      observation:
        "Two SEQUENTIAL gates, not a conflict: line 53 returns QUOTATION_READINESS_BLOCKED when !context.workflow.readyForQuotation, and only then line 56 calls loadCanonicalQuotationLines and returns QUOTATION_LINE_AUTHORITY_BLOCKED when !lineAuthority.ready. Reaching the second error proves the first gate passed, i.e. the presales workflow and the line authority are consistent -- the line authority is strictly additional.",
    },
    {
      type: "SOURCE",
      path: "worker/quotation-line-authority.mjs",
      symbol: "loadCanonicalQuotationLines",
      observation:
        "Selects BOQ items with currentBoqEligibleForEngineeringPredicate, so BOQ-001's Excluded row-type handling is honoured and the two negative-case items are correctly out of scope. It then evaluates projectPanelSizingBlockers once, before the per-item loop, so the project-level panel blocker is picked up without any per-item change.",
    },
    {
      type: "RUNTIME",
      path: "live local D1, read-only",
      symbol: "fire_alarm_panel_sizing_snapshots",
      observation: "0 rows for EVERY project. Combined with the gate above, no Fire Alarm project in this environment has ever cleared PANEL_SIZING_SNAPSHOT_REQUIRED.",
    },
    {
      type: "RUNTIME",
      path: "live local D1, read-only",
      symbol: "product_attributes",
      observation:
        "0 rows for attribute_name='added_slc_loops'. The attributes that do exist are panel_capacity, detector_capacity, module_capacity, network_capacity, slc_loop_count, battery_capacity_in_cabinet, battery_charger_capacity. loadLoopExpansionEvidence requires Approved current added_slc_loops evidence and fails APPROVED_EXPANSION_EVIDENCE_REQUIRED without it, so the expansion unit cannot be sized in ANY environment here, fixture or live.",
    },
    {
      type: "SOURCE",
      path: "worker/fire-alarm-panel-sizing-api.mjs",
      symbol: "loadArchitecture (line 74)",
      observation:
        "Requires a current consumable APPROVED ARCHITECTURE VERSION: context.status must be READY_FOR_STAGE4_BRIDGE with an integer architectureVersion and provenance.readFromVersionId, else CURRENT_APPROVED_ARCHITECTURE_REQUIRED. This is the Stage 4 DRAWING ARCHITECTURE bridge -- a stage the current Golden journey does not perform.",
    },
    {
      type: "SOURCE",
      path: "worker/fire-alarm-panel-sizing-api.mjs",
      symbol: "currentSlcPoolBoqItemIds / loadDependencies (lines 155-170, 404-414)",
      observation:
        "Fail-closed completeness contract: every current engineering-eligible BOQ item whose CURRENT governed classification lands in an SLC pool MUST appear in command.allocations, or no snapshot is written. An SLC-pool item is typically a detector, so a Fire Alarm BOQ with a detector but no panel still cannot produce a snapshot.",
    },
    {
      type: "SOURCE",
      path: "worker/fire-alarm-panel-sizing-api.mjs",
      symbol: "loadAllocationDependencies (line 123) and loadPanelDependency (line 350)",
      observation:
        "Per item: a valid current selected quantity (CURRENT_SELECTED_QUANTITY_REQUIRED), a current requirement profile (CURRENT_REQUIREMENT_PROFILE_REQUIRED), and an exact SLC pool classification. Per panel: the exact current Approved primary product selection, a non-stale match run, a current control-panel classification, canonical product identity, Approved capacity evidence, and the two-hop expansion chain.",
    },
    {
      type: "SOURCE",
      path: "worker/fire-alarm-panel-sizing-api.mjs",
      symbol: "assertPanelCountMatchesSelectedQuantity (line 331)",
      observation:
        "Iterates panels || [], so an EMPTY panel array passes trivially. That is not an escape hatch in practice, because the SLC-pool completeness check above still demands allocation of every detector/module, and allocation is only meaningful against a panel.",
    },
    {
      type: "STRUCTURAL",
      path: "tests/e2e/seed-golden-catalog.sql",
      symbol: "tables seeded",
      observation:
        "Seeds product_manufacturers, product_brands, product_families, product_sources, library_products, product_source_evidence and engineering_relationships. It seeds NO product_accessories and NO product_attributes. The expansion chain the sizing path requires is therefore absent from the Golden fixture by construction, not by accident.",
    },
  ],
  production_path: [
    "engineer completes matching, safety, pricing and commercial review on a Fire Alarm project",
    "presales workflow reports readyForQuotation = true (first gate passes)",
    "quotation draft runs the stricter line-authority gate",
    "projectPanelSizingBlockers finds no snapshot and raises PANEL_SIZING_SNAPSHOT_REQUIRED",
    "quotation is refused; the project cannot be quoted, approved, issued or exported",
  ],
  affected_routes: [
    "POST /api/projects/:id/presales-workflow/quotation/draft",
    "GET/POST /api/projects/:id/fire-alarm/panel-sizing",
  ],
  affected_tables: ["fire_alarm_panel_sizing_snapshots", "product_accessories", "product_attributes"],
  affected_domains: ["Golden E2E", "Fire Alarm", "Quotation", "Pricing"],
  impact: {
    engineering:
      "The quotation path is unreachable for every Fire Alarm project until governed panel sizing can be recorded. The gate is correct; the enabling evidence chain is absent.",
    commercial: "A Fire Alarm tender cannot be quoted, issued or exported. This is the commercial blocking defect for the whole Fire Alarm domain.",
    governance:
      "No bypass is proposed. The fail-closed gate is the control that prevents pricing a quotation whose panel cannot physically serve its demand, and it must keep working.",
    data_integrity: "None observed. No data was written by this investigation; the live D1 was opened read-only.",
  },
  reproduction:
    "npm run test:e2e:golden -- reaches tests/e2e/golden-full-journey.spec.ts:464 and fails with QUOTATION_LINE_AUTHORITY_BLOCKED / blockers [\"PANEL_SIZING_SNAPSHOT_REQUIRED\"].",
  tests_covering: [
    { test: "tests/bom-001-r7-expansion-bridge.test.mjs", assertion: "7/7 pass -- the gate's own semantics are correct and are NOT reopened by this issue" },
  ],
  tests_missing: [
    "No end-to-end test records a governed panel-sizing snapshot from a real Drawing/Evidence -> Architecture -> panel-sizing command. tests/r7-panel-sizing-production.test.mjs exercises the engine and the route against constructed fixtures, but no journey-level test proves the stage is reachable from document intake onward.",
  ],
  confidence: "HIGH",
  blocking_stage: ["GOLDEN", "PRE_GOLDEN"],
  recommended_fix:
    "Extend the Golden journey -- do NOT weaken the gate. In order: (1) drive the Drawing/Evidence stage to a current approved architecture version so loadArchitecture stops failing CURRENT_APPROVED_ARCHITECTURE_REQUIRED; (2) establish a current selected quantity (quantity-source decision) for the panel line and for every SLC-pool item; (3) seed the fictional Golden catalog with the two-hop Expansion Module chain and the Approved capacity attributes INCLUDING added_slc_loops for the loop expansion module, exactly as the fixture already seeds a fictional detector and panel with fictional-but-internally-consistent specifications; (4) POST the panel-sizing command with every SLC-pool item allocated and the panel count equal to the current selected panel quantity; (5) then the quotation draft proceeds.",
  explicit_constraints_on_any_fix: [
    "Do NOT relax, special-case or bypass PANEL_SIZING_SNAPSHOT_REQUIRED, and do not treat an absent snapshot as zero requirement. BOM-001 exists precisely to prevent that.",
    "Do NOT seed project rows to make the journey pass. Seeding CATALOG evidence (products, accessories, approved attributes) is legitimate fixture setup and is what the fixture already does; fabricating project-level governed state to skip a gate is not.",
    "Fixture capacity values belong to the fictional Golden products and must be internally consistent with the fixture's own detector and panel specifications. They are fixture data, NOT manufacturer claims, and must not be presented as real product evidence.",
    "Keep the journey's existing negative cases (incomplete, noMatch) excluded via row type; the line authority already honours that and the fix must not disturb it.",
  ],
  ownership_note:
    "This diagnosis was produced read-only while the concurrent Golden lane was idle (no e2e spec or fixture change for ~28 minutes, stable tree, no run in flight). The lane owns tests/e2e/golden-full-journey.spec.ts and tests/e2e/seed-golden-catalog.sql and was actively extending the journey toward this stage, so the implementation was deliberately NOT taken over here: rewriting another lane's journey and catalog mid-programme, on a stage that requires the drawing/architecture bridge, is precisely the racing the recovery brief forbids. This entry is the durable hand-off.",
  owner_lane: "concurrent-golden-lane",
  related_issues: ["BOM-001", "BOM-002", "BOQ-001", "PRICE-001"],
  source_fingerprints: [
    "worker/fire-alarm-panel-sizing-api.mjs@loadDependencies",
    "worker/quotation-line-authority.mjs@projectPanelSizingBlockers",
  ],
  graph: { nodes: [], paths: [], communities: [] },
  resolution: { resolved_at: null, resolved_baseline: null, resolution_evidence: [], regression_guard: null },
  current: true,
  first_seen_baseline: BASELINE,
  last_seen_baseline: BASELINE,
  first_seen_at: now,
  last_seen_at: now,
});

ledger.golden_e2e_status = {
  observed_at: now,
  verdict: "GOLDEN E2E FAILED -- blocked at the Quotation stage",
  tree_fingerprint_at_observation: "739c9f4374ad6122",
  run_evidence: {
    command: "npm run test:e2e:golden",
    smoke_spec: "PASSED (tests/e2e/golden-smoke.spec.ts, 2.8s)",
    full_journey: "FAILED at tests/e2e/golden-full-journey.spec.ts:464",
    failure: "409 QUOTATION_LINE_AUTHORITY_BLOCKED, blockers [\"PANEL_SIZING_SNAPSHOT_REQUIRED\"]",
    progression_across_the_concurrent_lane:
      "The concurrent lane advanced this same spec from 1 captured checkpoint (14:45) to 3 (14:56) and then to the Quotation stage, so matching, technical approval, safety approval, pricing, pricing-run approval and final commercial review are all now driven successfully. The failure moved forward each time; it is not a regression.",
  },
  stages_reached_and_passing:
    "Project creation, document upload, classification, BOQ extraction, specification extraction, BOQ downstream approval, requirement approval, requirement-profile readiness, product matching, safety evaluation and approval (including the governed override path), pricing scenario creation and selection, supplier price source selection, cost build-up, price calculation, pricing-run commercial approval, and the final review queue sync with Approve Technical Match and Approve Commercial Cost. The workflow reported readyForQuotation = true.",
  first_unfinished_stage: "Quotation -- and the true first gap is one stage earlier: Drawing/Evidence -> approved architecture version, which governed panel sizing requires.",
  blocking_issue: "GOLDEN-001",
  ownership: "concurrent-golden-lane (idle ~28 min at observation; not taken over)",
  honest_note:
    "Golden E2E is NOT complete and is not claimed to be. The single remaining blocker is fully characterised: it is missing governed SLC capacity/expansion evidence and a missing Drawing/Evidence architecture stage, both in the journey and the fixture, not a product defect and not a gate that should be relaxed.",
};

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
const after = JSON.parse(readFileSync(path, "utf8"));
console.log("GOLDEN-001:", after.issues.find((i) => i.id === "GOLDEN-001").status);
console.log("verdict:", after.golden_e2e_status.verdict);
console.log("open:", after.issues.filter((i) => i.status === "OPEN").map((i) => i.id).join(", "));
