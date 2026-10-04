// BOM-002 -- the R7 expansion productId is resolved then discarded at the
// calculation boundary. Deduplicated against BOM-001 (RESOLVED) and against the
// evaluated BOM-001_residual. Records the Golden-path tracing that decides
// whether it is required.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
if (ledger.issues.some((i) => i.id === "BOM-002")) throw new Error("BOM-002 already present");

const now = "2026-09-27T15:00:00Z";
const BASELINE = ledger.baseline.id;

ledger.issues.push({
  id: "BOM-002",
  title: "The R7 expansion product identity is resolved, then discarded before the BOM can consume it",
  domain: "BOM / Fire Alarm",
  severity: "P2 - a real capability gap with NO current safety exposure and NO Golden-path requirement",
  status: "OPEN",
  issue_class: "IDENTITY_DISCARDED_AT_BOUNDARY",
  summary:
    "Governed panel sizing resolves the required expansion hardware all the way to a canonical product identity -- panel -> mounting unit -> loop expansion unit, each hop exactly one current Approved relationship -- and hands calculateSlcExpansion a { productId, partNumber } pair for both. The calculator returns only part-number strings, so the resolved productId never reaches worker/boq-line-bom-api.mjs, which builds product-identity lines and contains no reference to expansion at all. The consequence is a missing capability, not wrong money: expansion hardware can never become a priced BOM line, so the only correct way to clear PANEL_SIZING_EXPANSION_REQUIRED is to re-run sizing with a panel selection that needs no expansion.",
  deduplication: {
    against_BOM_001:
      "NOT a duplicate. BOM-001 was the missing fail-closed GATE and is RESOLVED with a 7/7 guard. That gate is correct, still enforced, and is not reopened here.",
    against_BOM_001_residual:
      "This is the RESIDUAL's finding promoted to a tracked issue. The residual question ('can the expansion part number resolve to a canonical governed product identity?') is answered (A) YES, and this issue records the narrower thing the answer exposed: the identity is available and then thrown away.",
    against_PRICE_001_DRAW_001_BOQ_001:
      "No overlap. Those govern currency normalisation, drawing-vs-device quantity, and BOQ downstream eligibility respectively. None of them is about a resolved product identity failing to cross a module boundary.",
  },
  evidence: [
    {
      type: "SOURCE",
      path: "worker/fire-alarm-panel-sizing-api.mjs",
      symbol: "loadExpansionPath",
      observation:
        "resolves the chain through product_accessories JOIN library_products with relationship_type='Expansion Module' AND review_status='Approved' AND superseded_at IS NULL AND deleted_at IS NULL and product identity_status='Active'; exactExpansionRelationships fails AMBIGUOUS_EXPANSION_RELATIONSHIP unless there is exactly one current Approved relationship per hop (line 287).",
    },
    {
      type: "SOURCE",
      path: "worker/fire-alarm-panel-sizing-api.mjs",
      symbol: "expansionOptions",
      observation:
        "loopExpansionUnit carries productId (line 299) and partNumber (line 300); mountingUnit carries productId (line 304) and partNumber (line 305). The governed identity IS in hand at the input boundary.",
    },
    {
      type: "SOURCE",
      path: "app/domain/fire-alarm-slc-capacity-calculator.mjs",
      symbol: "calculateSlcExpansion return",
      observation:
        "returns selectedExpansionType = loopExpansionUnit.partNumber (line 162) and mountingUnit = { partNumber, quantity, capacityPerMountingUnit } (line 153). The productId present on the input is not carried to the output.",
    },
    {
      type: "SOURCE",
      path: "app/domain/calculation-requirement-engine.mjs",
      symbol: "expansionRequired",
      observation: "line 160 repackages it as { requiredQuantity, expansionPartNumber, mountingUnit } -- part numbers only, the flattening repeated one layer up.",
    },
    {
      type: "STRUCTURAL",
      path: "worker/boq-line-bom-api.mjs",
      symbol: "expansion references",
      observation: "grep for 'expansion' returns no match. The BOM builder has no product-identity-keyed input to consume, which is a mechanical consequence of the two entries above rather than an independent omission.",
    },
    {
      type: "RUNTIME",
      path: "live local D1, read-only",
      symbol: "product_accessories WHERE relationship_type='Expansion Module'",
      observation:
        "8 rows, all review_status='Approved', superseded_at IS NULL, accessory identity_status='Active'. The loop expansion unit resolves to part 5815RMK (product_718a5790-e3b9-4fbe-8372-d0e4a66e6926) and the mounting unit to 6815 (product_d03ba56e-a8c2-4e5b-8c9d-47c683b012c8). The governed data the propagation would need already exists and is exactly-one per hop.",
    },
  ],
  golden_path_requirement: {
    question: "Does any current Golden path require that identity?",
    answer: "NO. Traced against the live Golden project, not assumed.",
    measurements: {
      golden_project: "project_ae501b85-9c12-4332-bf8e-787c90f2d388, 'Al Mousa School — Clean Golden Run', Fire Alarm",
      boq_items: "108 = 90 'BOQ Item' + 13 'Subsection Header' + 5 'Section Header' (the R11 partition, re-verified today)",
      documents: 15,
      product_match_runs: 0,
      project_quotation_lines: 0,
      panel_sizing_snapshots_for_golden: 0,
      panel_sizing_snapshots_all_projects: 0,
    },
    reasoning:
      "projectPanelSizingBlockers reads the highest-version snapshot. With no snapshot for any project, it returns PANEL_SIZING_SNAPSHOT_REQUIRED and never evaluates the expansion requirement at all. PANEL_SIZING_EXPANSION_REQUIRED -- the only gate that depends on the discarded identity -- is therefore unreachable in the current Golden state. Golden blocks earlier, in the correct fail-closed order.",
    consequence:
      "BOM-002 is NOT a Golden blocker and must not be allowed to become one. It is a capability gap that would surface only for a Fire Alarm project that actually runs governed panel sizing AND proves a non-zero required expansion quantity -- a state no project in the live database is in.",
  },
  why_not_implemented_now: [
    "It is not required by any current Golden path, so it cannot block the programme's terminal state.",
    "It reshapes a governed, fingerprinted, immutable persisted contract (fire_alarm_panel_sizing_snapshots is protected by an immutability trigger) plus the BOM builder -- the pricing/BOM authority layer.",
    "A concurrent writer is actively editing worker/fire-alarm-panel-sizing-api.mjs and tests/e2e/golden-full-journey.spec.ts. Implementing a cross-layer contract change in that file right now would race an active writer.",
    "The programme rule is smallest-sufficient-fix: a missing capability is not a defect, and nothing is currently wrong.",
  ],
  smallest_governed_propagation_when_unblocked: [
    "Carry the already-resolved productId through the calculation output: selectedExpansionType becomes a { productId, partNumber } pair and mountingUnit likewise. No new authority, no new query, no new relationship resolution -- the identity is already resolved at worker/fire-alarm-panel-sizing-api.mjs:296-308.",
    "Persist it into the panel-sizing snapshot so the governed record states WHICH product the requirement is, not only which part number.",
    "Give worker/boq-line-bom-api.mjs a governed, fail-closed consumer so the expansion product enters BOM/costing as a real product-identity line at the calculator's proven quantity.",
  ],
  invariants_any_implementation_must_preserve: [
    "BOM-001's fail-closed gate must not weaken: PANEL_SIZING_EXPANSION_REQUIRED may clear ONLY when a BOM line for the expansion product actually exists, is priced and is approved.",
    "An existing fail-closed snapshot with no matching BOM line must NOT silently become ready. The blocker may only clear through a NEW snapshot plus a real priced line.",
    "The expansion product must NEVER be auto-selected because a compatible product happens to exist. Selection remains the single Approved current relationship, and ambiguity remains AMBIGUOUS_EXPANSION_RELATIONSHIP.",
    "Quantities must remain the calculator's: requiredExpansionQuantity for the loop unit and the mounting unit's own quantity, never re-derived in the BOM layer.",
    "The change must not retroactively reshape any existing snapshot or any quotation evidence_fingerprint.",
  ],
  blocking_stage: ["HARDENING"],
  regression_guard: {
    existing: "tests/bom-001-r7-expansion-bridge.test.mjs (7/7) pins the blocker semantics this work must not weaken.",
    required_when_implemented:
      "A test asserting the resolved productId survives the calculation boundary and that the blocker clears only against a real priced BOM line for that exact productId.",
  },
  owner_lane: "N",
  related_issues: ["BOM-001", "PRICE-001", "BOQ-001"],
  source_fingerprints: [
    "app/domain/fire-alarm-slc-capacity-calculator.mjs@return-shape",
    "worker/fire-alarm-panel-sizing-api.mjs@loadExpansionPath",
  ],
  graph: { nodes: [], paths: [], communities: [] },
  resolution: { resolved_at: null, resolved_baseline: null, resolution_evidence: [], regression_guard: null },
  current: true,
  first_seen_baseline: BASELINE,
  last_seen_baseline: BASELINE,
  first_seen_at: now,
  last_seen_at: now,
});

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
const after = JSON.parse(readFileSync(path, "utf8"));
const issue = after.issues.find((i) => i.id === "BOM-002");
console.log("BOM-002:", issue.status, "| golden required:", issue.golden_path_requirement.answer);
console.log("open issues now:", after.issues.filter((i) => i.status === "OPEN").map((i) => i.id).join(", "));
