// BOM-001 residual evaluation. The ledger recorded this question as
// "NOT YET EVALUATED - deliberately not assumed either way". This evaluates it
// against current source and records the outcome, with no change to behaviour.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
const residual = ledger.residual_dependencies?.["BOM-001_residual"];
if (!residual) throw new Error("BOM-001_residual missing from the ledger");
if (residual.evaluated_at) throw new Error("already evaluated; refusing to double-write");

const now = "2026-09-27T15:05:00Z";

residual.evaluated_at = now;
residual.status = "EVALUATED";
residual.outcome = "(A) an exact governed canonical product identity exists and is already resolved, fail-closed, by production code";
residual.headline =
  "The residual's stated premise was too pessimistic and is now falsified by source. It assumed the R7 expansion requirement was 'a part number with no governed product identity behind it'. It is not. The expansion chain is resolved through the governed product library by production code, and it fails closed at every hop. The genuinely missing link is narrower and different in kind: the resolved identity is DISCARDED at the calculation boundary and never reaches the BOM builder.";
residual.trace = [
  {
    step: "R7 capacity calculation",
    finding:
      "app/domain/fire-alarm-slc-capacity-calculator.mjs:140-163 computes requiredExpansionQuantity as a COUNT and sets selectedExpansionType = loopExpansionUnit.partNumber. The governing comment above worker/quotation-line-authority.mjs:70-71 states R7 'deliberately does not produce a concrete product identity; R7 returns a part number, never a product_id'. That statement is accurate about the calculation's OUTPUT and is the origin of this residual -- but it was read as a statement about the whole pipeline.",
  },
  {
    step: "the part number's actual origin",
    finding:
      "worker/fire-alarm-panel-sizing-api.mjs:291-325 loadExpansionPath does NOT use a configured or hardcoded part number. It walks the governed library: product_accessories JOIN library_products, filtered to relationship_type='Expansion Module' AND review_status='Approved' AND superseded_at IS NULL AND deleted_at IS NULL, with the product at identity_status='Active'. It resolves panel -> mounting unit -> loop expansion unit and requires EXACTLY ONE current Approved relationship at each hop (exactExpansionRelationships fails 'AMBIGUOUS_EXPANSION_RELATIONSHIP' when rows.length !== 1, line 287).",
  },
  {
    step: "a governed identity IS in hand at the boundary",
    finding:
      "expansionOptions.loopExpansionUnit carries productId (line 299) and partNumber (line 300); expansionOptions.mountingUnit carries productId (line 304) and partNumber (line 305). Both are canonical library_products.id values reached only through Approved, current, non-superseded, relationship-approved evidence. loopsAddedPerUnit itself is governed evidence, not an assumption: loadLoopExpansionEvidence (lines 269-272) requires Approved current added_slc_loops evidence and fails closed on absence or conflict.",
  },
  {
    step: "where the identity is lost",
    finding:
      "calculateSlcExpansion consumes expansionOptions but returns only part-number strings: selectedExpansionType = loopExpansionUnit.partNumber, and mountingUnit = { partNumber, quantity, capacityPerMountingUnit } (lines 153, 162-164). The productId present at the input boundary is not carried into the output. The same flattening occurs one layer up: app/domain/calculation-requirement-engine.mjs:160 packages expansionRequired as { requiredQuantity, expansionPartNumber, mountingUnit } -- again part numbers only.",
  },
  {
    step: "the BOM consumer",
    finding:
      "worker/boq-line-bom-api.mjs builds product-identity lines and contains ZERO references to expansion (verified by direct grep, not inferred). It has no product-identity-keyed input to consume, which is the mechanical consequence of step 4 rather than an independent omission.",
  },
];
residual.conclusions = {
  identity_resolution: "NOT the gap. It is implemented, governed, and fail-closed at every hop.",
  compatibility_authority:
    "NOT load-bearing for this question. MATCH-001 made the relationship store correctable, which is what makes the superseded_at IS NULL filter a sound currentness test here. But the expansion path does not depend on compatibility EXISTING to select a product: the selection is the single Approved current relationship, and ambiguity fails closed. This satisfies the residual's explicit constraint that selection must NOT be auto-made merely because compatibility exists.",
  the_real_gap:
    "A data-plumbing boundary, not a missing authority. A governed product identity is resolved and then flattened to a string before the BOM builder can see it.",
  safety_position:
    "Unchanged and still correct. PANEL_SIZING_EXPANSION_REQUIRED keeps a Fire Alarm quotation from reaching ready:true while proven expansion hardware is unpriced, so the missing capability cannot produce a wrong quotation. The gap is a missing capability (expansion hardware cannot enter the BOM as a real line), not a wrong-money defect.",
  golden_relevance:
    "Unchanged and not blocking Golden: no Golden Fire Alarm project has a panel-sizing snapshot at all, so requiredExpansionQuantity is never produced there. It blocks at PANEL_SIZING_SNAPSHOT_REQUIRED first, which is the correct fail-closed order.",
};
residual.bounded_remaining_work = {
  status: "UNBLOCKED BY ANY OTHER LEDGER ISSUE, but deliberately NOT implemented in this slice",
  specification: [
    "Carry the already-resolved productId through the calculation output: selectedExpansionType becomes a { productId, partNumber } pair (or a sibling field), and mountingUnit likewise. No new authority, no new query, no new relationship resolution -- the identity is already in hand at worker/fire-alarm-panel-sizing-api.mjs:296-308.",
    "Propagate it into the persisted panel-sizing snapshot so the governed record states WHICH product the requirement is, not only which part number.",
    "Give worker/boq-line-bom-api.mjs a governed, fail-closed consumer: when the current snapshot proves requiredExpansionQuantity > 0, the expansion product enters BOM/costing as a real product-identity line at the proven quantity, and the PANEL_SIZING_EXPANSION_REQUIRED blocker clears ONLY when that line actually exists and is priced and approved.",
  ],
  hard_constraints_any_implementation_must_honour: [
    "The calculation contract is persisted, fingerprinted and protected by an immutability trigger (fire_alarm_panel_sizing_snapshots). Changing the output shape is a governed contract change, not a refactor, and must not retroactively reshape any existing snapshot or any quotation evidence_fingerprint.",
    "An existing fail-closed snapshot with no matching BOM line must NOT silently become ready. The blocker may only clear through a NEW snapshot plus a real priced line.",
    "The expansion product must never be auto-selected because a compatible product happens to exist. Selection stays the single Approved current relationship, and ambiguity stays AMBIGUOUS_EXPANSION_RELATIONSHIP.",
    "Quantities must remain the calculator's: requiredExpansionQuantity for the loop unit and the mounting unit's own quantity, never re-derived in the BOM layer.",
  ],
  why_not_now: [
    "It reshapes a governed, fingerprinted, immutable persisted contract and the BOM builder, i.e. the pricing/BOM authority layer, while a concurrent writer is actively editing this same tree and Golden E2E is mid-flight. That is the highest-risk place to make a cross-layer contract change.",
    "It is a missing capability, not a defect. Nothing is currently wrong: the fail-closed gate is correct and the programme's smallest-sufficient-fix rule does not require building an unexercised capability ahead of a certification run.",
    "The existing regression guard (tests/bom-001-r7-expansion-bridge.test.mjs, 7/7) must keep passing unchanged; it pins blocker semantics that this work must not weaken.",
  ],
};
residual.evidence_summary = {
  "tests/bom-001-r7-expansion-bridge.test.mjs": "7/7 pass, unchanged. The already-resolved fail-closed gate is NOT reopened by this evaluation.",
  "worker/fire-alarm-panel-sizing-api.mjs": "lines 275-325, read directly",
  "app/domain/fire-alarm-slc-capacity-calculator.mjs": "lines 132-169, read directly",
  "app/domain/calculation-requirement-engine.mjs": "line 160, read directly",
  "worker/boq-line-bom-api.mjs": "grep for 'expansion' returns no match",
};

ledger.residual_dependencies.BOM_001_residual_status =
  "EVALUATED (A) at 2026-09-27T15:05:00Z. Identity resolution is implemented and fail-closed; the residual's premise was too pessimistic. The remaining gap is bounded data plumbing from an already-resolved product identity into the BOM builder, specified and deliberately not implemented while a concurrent writer is active in the same tree. Nothing about BOM-001's fail-closed gate is reopened.";

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
console.log("BOM-001 residual:", JSON.parse(readFileSync(path, "utf8")).residual_dependencies["BOM-001_residual"].outcome);
