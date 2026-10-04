// FIRE ALARM IN-HOUSE vs EXTERNAL COMMERCIAL WORKFLOW -- routing validation.
//
// Eleven assertions. These prove the BRANCH, not just the brand: an in-house
// brand must route to internal selection and pricing, an external brand must
// route to a supplier RFQ, and the in-house routing must not require a supplier
// RFQ or leak a supplier-proposal state into the normal flow.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveFireAlarmBrandStrategy, commercialWorkflowFor, resolveBrandRelationship,
  IN_HOUSE_FIRE_ALARM_POLICY,
} from "../app/domain/fire-alarm-brand-strategy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const readFile = (p) => readFileSync(p, "utf8");

const base = (over = {}) => ({
  systemCategory: "FIRE_ALARM",
  mandatoryBrand: null,
  mandatoryBrandEvidence: [],
  standardsRegime: "ULF",
  addressablePointCount: 1877,
  pointCountBasis: "test",
  ...over,
});

/** Resolve a named brand through the real engine, as downstream routing would. */
const route = (brand, over = {}) =>
  over.mandatoryBrand !== undefined
    ? resolveFireAlarmBrandStrategy(base({ ...over, mandatoryBrand: brand, mandatoryBrandEvidence: brand ? ["clause"] : [] }))
    : commercialWorkflowFor(brand);

// ===========================================================================
// 1. Farenhyt routes to internal selection and pricing
// ===========================================================================
test("1 -- FARENHYT routes to INTERNAL_SELECTION_AND_PRICING", () => {
  const d = resolveFireAlarmBrandStrategy(base());
  assert.equal(d.preferredBrand, "FARENHYT");
  assert.equal(d.brandRelationship, "IN_HOUSE");
  assert.equal(d.commercialWorkflow, "INTERNAL_SELECTION_AND_PRICING");
  assert.equal(d.supplierIsSelectionAuthority, false, "the supplier is not the selection authority");
  assert.deepEqual(d.sequence, [
    "INTERNAL_DETAILED_TECHNICAL_SELECTION", "INTERNAL_BOM",
    "INTERNAL_COMMERCIAL_PRICING", "COSTING", "QUOTATION",
  ]);
});

// ===========================================================================
// 2. Gamewell routes to internal selection and pricing
// ===========================================================================
test("2 -- GAMEWELL routes to INTERNAL_SELECTION_AND_PRICING", () => {
  const d = resolveFireAlarmBrandStrategy(base({ addressablePointCount: 2500 }));
  assert.equal(d.preferredBrand, "GAMEWELL");
  assert.equal(d.brandRelationship, "IN_HOUSE");
  assert.equal(d.commercialWorkflow, "INTERNAL_SELECTION_AND_PRICING");
  assert.equal(d.requiresSupplierRfqBeforeCosting, false);
});

// ===========================================================================
// 3. Gent routes to internal selection and pricing
// ===========================================================================
test("3 -- GENT routes to INTERNAL_SELECTION_AND_PRICING", () => {
  const d = resolveFireAlarmBrandStrategy(base({ standardsRegime: "EN" }));
  assert.equal(d.preferredBrand, "GENT");
  assert.equal(d.brandRelationship, "IN_HOUSE");
  assert.equal(d.commercialWorkflow, "INTERNAL_SELECTION_AND_PRICING");
});

// ===========================================================================
// 4. NOTIFIER does NOT automatically route as in-house
// ===========================================================================
test("4 -- NOTIFIER does not route as IN_HOUSE merely by being Honeywell", () => {
  assert.equal(resolveBrandRelationship("NOTIFIER"), "EXTERNAL");
  const r = route("NOTIFIER");
  assert.equal(r.brandRelationship, "EXTERNAL");
  assert.equal(r.commercialWorkflow, "SUPPLIER_RFQ_AND_ENGINEER_REVIEW");
  // The explicit anti-inference rule: a shared parent company grants nothing.
  for (const honeywellBrand of ["NOTIFIER", "Honeywell", "IDP-PHOTO-IV", "N16", "FSP-951-IV"]) {
    assert.equal(resolveBrandRelationship(honeywellBrand), "EXTERNAL", honeywellBrand);
  }
  // Only the governed registry confers IN_HOUSE.
  assert.deepEqual([...IN_HOUSE_FIRE_ALARM_POLICY.companyBrandRegistry.IN_HOUSE], ["FARENHYT", "GAMEWELL", "GENT"]);
});

// ===========================================================================
// 5. An external brand may route to a supplier RFQ
// ===========================================================================
test("5 -- an EXTERNAL brand routes to SUPPLIER_RFQ_AND_ENGINEER_REVIEW", () => {
  const r = route("NOTIFIER");
  assert.equal(r.supplierIsSelectionAuthority, true);
  assert.equal(r.requiresSupplierRfqBeforeCosting, true);
  assert.deepEqual(r.sequence, [
    "PRELIMINARY_TECHNICAL_SELECTION", "PRELIMINARY_BOM", "SUPPLIER_RFQ",
    "SUPPLIER_DETAILED_SOLUTION", "ENGINEER_REVIEW", "APPROVED_BOM",
    "PRICE_APPROVAL", "COSTING", "QUOTATION",
  ]);
  // A brand nobody has heard of also routes EXTERNAL, never IN_HOUSE.
  assert.equal(resolveBrandRelationship("SOME_UNKNOWN_BRAND"), "EXTERNAL");
  assert.equal(resolveBrandRelationship(""), "EXTERNAL");
});

// ===========================================================================
// 6. An in-house brand does not require a supplier RFQ before costing
// ===========================================================================
test("6 -- an in-house brand does not require a supplier RFQ before costing", () => {
  for (const brand of ["FARENHYT", "GAMEWELL", "GENT"]) {
    const r = commercialWorkflowFor(brand);
    assert.equal(r.requiresSupplierRfqBeforeCosting, false, brand);
    assert.equal(r.sequence.includes("SUPPLIER_RFQ"), false, `${brand} sequence must not contain SUPPLIER_RFQ`);
    assert.equal(r.sequence.includes("COSTING"), true, `${brand} must still reach costing`);
  }
  // And the policy text must say so, so the document and runtime agree.
  const policy = readFile(join(HERE, "..", "docs", "fire-alarm-brand-and-pre-sales-policy.md"));
  assert.match(policy, /does NOT normally issue a supplier RFQ/);
  assert.match(policy, /NOT apply this workflow automatically to Farenhyt, Gamewell or Gent/);
});

// ===========================================================================
// 7. A supplier-proposal state cannot appear in the normal in-house flow
// ===========================================================================
test("7 -- SUPPLIER_PROPOSED_TECHNICAL_SOLUTION belongs to the EXTERNAL flow only", () => {
  const inHouse = commercialWorkflowFor("FARENHYT");
  const external = commercialWorkflowFor("NOTIFIER");
  // The in-house sequence contains no supplier-selection stage at all.
  assert.equal(inHouse.sequence.some((s) => /SUPPLIER/i.test(s)), false);
  assert.equal(external.sequence.includes("SUPPLIER_DETAILED_SOLUTION"), true);
  assert.equal(external.sequence.includes("ENGINEER_REVIEW"), true, "and it is reviewed before approval");
  // The retained external RFQ generator is explicitly marked not-Al-Mousa.
  const src = readFile(join(HERE, "..", "scripts", "build-al-mousa-farenhyt-rfq.mjs"));
  assert.match(src, /NOT THE AL MOUSA PATH/);
  assert.match(src, /DO NOT ISSUE THIS RFQ FOR AL MOUSA/);
  assert.match(src, /retained for EXTERNAL-brand Fire Alarm RFQs only/);
});

// ===========================================================================
// 8. FlashScan is not mandatory for Al Mousa after the human decision
// ===========================================================================
test("8 -- FLASHSCAN_MANDATORY = NO for Al Mousa after the human decision", () => {
  // The governed decision records it explicitly and closes the pending item.
  const src = readFile(join(HERE, "..", "scripts", "record-al-mousa-fire-alarm-brand-decisions.mjs"));
  assert.match(src, /flashscanMandatory: false/);
  assert.match(src, /FLASHSCAN_MANDATORY = NO/);
  assert.match(src, /PENDING_CONSULTANT_CLARIFICATION/);
  assert.match(src, /must NOT be/);
  assert.match(src, /reinterpreted as a mandatory ecosystem requirement/);
  // The decision script reports it closed, not open.
  const policy = readFile(join(HERE, "..", "docs", "fire-alarm-brand-and-pre-sales-policy.md"));
  assert.match(policy, /FLASHSCAN_MANDATORY = NO/);
  assert.match(policy, /closes the earlier `PENDING_CONSULTANT_CLARIFICATION`/);
  // And the brand decision therefore uses mandatoryBrand = null, not a brand.
  assert.equal(resolveFireAlarmBrandStrategy(base()).decidedByStep, 4, "decided by policy, not by a mandate");
});

// ===========================================================================
// 9. Al Mousa resolves to Farenhyt under the current governed inputs
// ===========================================================================
test("9 -- Al Mousa resolves to FARENHYT / IN_HOUSE / internal workflow", () => {
  const d = resolveFireAlarmBrandStrategy(base({
    mandatoryBrand: null,                 // no mandatory brand
    standardsRegime: "ULF",                // UL/FM-led
    addressablePointCount: 1877,           // <= 2000
  }));
  assert.equal(d.preferredBrand, "FARENHYT");
  assert.equal(d.brandRelationship, "IN_HOUSE");
  assert.equal(d.commercialWorkflow, "INTERNAL_SELECTION_AND_PRICING");
  assert.equal(d.addressablePointCount, 1877);
});

// ===========================================================================
// 10. Existing NOTIFIER technical evidence remains intact
// ===========================================================================
test("10 -- NOTIFIER technical evidence is preserved, not deleted", () => {
  // The reclassification helper still carries the prior basis forward.
  assert.match(readFile(join(HERE, "..", "app", "domain", "fire-alarm-brand-strategy.mjs")),
    /Technical compatibility evidence for the prior brand remains valid and is retained unchanged/);
  // The corpus ingestion path still exists and is untouched by this correction.
  const ingest = readFile(join(HERE, "..", "scripts", "ingest-notifier-fire-alarm-corpus.mjs"));
  assert.match(ingest, /NOTIFIER|FSP-951|FST-951/);
  // And the brand decision script still documents NOTIFIER as a benchmark.
  const decide = readFile(join(HERE, "..", "scripts", "decide-al-mousa-fire-alarm-brand.mjs"));
  assert.match(decide, /not deleted and not declared technically wrong/);
  assert.match(decide, /TECHNICALLY_VALID_ALTERNATIVE|technically valid/);
});

// ===========================================================================
// 11. Rerun is idempotent
// ===========================================================================
test("11 -- reruns are deterministic and the persist script is idempotent by construction", () => {
  assert.deepEqual(resolveFireAlarmBrandStrategy(base()), resolveFireAlarmBrandStrategy(base()));
  assert.deepEqual(commercialWorkflowFor("FARENHYT"), commercialWorkflowFor("FARENHYT"));
  assert.deepEqual(commercialWorkflowFor("NOTIFIER"), commercialWorkflowFor("NOTIFIER"));
  // The persist script defaults to dry-run, so a bare invocation cannot write.
  const src = readFile(join(HERE, "..", "scripts", "record-al-mousa-fire-alarm-brand-decisions.mjs"));
  assert.match(src, /const APPLY = process\.argv\.includes\("--apply"\)/);
  assert.match(src, /already recorded \(idempotency key stable\)/);
  // And the idempotency lookup is keyed on entity_id, which is where the key is stored.
  assert.match(src, /entity_id=\?/);
  assert.doesNotMatch(src, /reason LIKE \?/);
});
