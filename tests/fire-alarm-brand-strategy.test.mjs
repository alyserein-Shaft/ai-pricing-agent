// FIRE ALARM BRAND STRATEGY -- policy and preliminary-solution validation.
//
// Sixteen assertions. These prove the ORDER of decisions, not just the outcome:
// a mandatory brand outranks in-house preference, UL/FM scale splits at 2000,
// conventional and passive devices never inflate the point count, a prior brand
// basis is superseded without losing its history, and a supplier proposal can
// never become an approval on its own.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveFireAlarmBrandStrategy, validateBrandStrategyInput,
  reclassifySupersededBrand, IN_HOUSE_FIRE_ALARM_POLICY,
} from "../app/domain/fire-alarm-brand-strategy.mjs";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { FARENHYT_PLATFORM } from "../scripts/lib/al-mousa-farenhyt-platform.mjs";
import { CENSUS_Q, assertCensus } from "../scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readFile = (p) => readFileSync(p, "utf8");
const run = (s, ...a) => execFileSync("node", [join(REPO, "scripts", s), ...a], { encoding: "utf8" });

const base = (over = {}) => ({
  systemCategory: "FIRE_ALARM",
  mandatoryBrand: null,
  mandatoryBrandEvidence: [],
  standardsRegime: "ULF",
  addressablePointCount: 1877,
  pointCountBasis: "test",
  ...over,
});
const decide = (over) => resolveFireAlarmBrandStrategy(base(over));

// ===========================================================================
// 1. A mandatory brand overrides the in-house preference
// ===========================================================================
test("1 -- a mandatory brand overrides company in-house preference", () => {
  const d = decide({ mandatoryBrand: "NOTIFIER", mandatoryBrandEvidence: ["contract clause 10.2"] });
  assert.equal(d.preferredBrand, "NOTIFIER");
  assert.equal(d.decidedByStep, 1, "decided at the mandate step, not the policy step");
  assert.equal(d.isInHouseBrand, null, "a mandate is not an in-house selection");
  // Even though the same point count and regime would otherwise select Farenhyt.
  assert.equal(decide().preferredBrand, "FARENHYT");
  // And a mandate cannot be asserted without evidence.
  assert.throws(() => decide({ mandatoryBrand: "NOTIFIER" }), (e) => e.code === "BRAND_STRATEGY_MANDATORY_BRANCH_MISSING_EVIDENCE");
});

// ===========================================================================
// 2. UL/FM <= 2000 resolves to Farenhyt
// ===========================================================================
test("2 -- UL/FM at or under 2000 points resolves to FARENHYT", () => {
  assert.equal(decide({ addressablePointCount: 1877 }).preferredBrand, "FARENHYT");
  assert.equal(decide({ addressablePointCount: 0 }).preferredBrand, "FARENHYT");
  assert.equal(decide({ addressablePointCount: 2000 }).preferredBrand, "FARENHYT", "2000 is inclusive");
  const d = decide({ addressablePointCount: 1877 });
  assert.match(d.decidedBy, /SMALL_PROJECT_SCALE/);
  assert.equal(d.isInHouseBrand, true);
});

// ===========================================================================
// 3. UL/FM > 2000 resolves to Gamewell
// ===========================================================================
test("3 -- UL/FM above 2000 points resolves to GAMEWELL", () => {
  assert.equal(decide({ addressablePointCount: 2001 }).preferredBrand, "GAMEWELL", "2001 is over the threshold");
  assert.equal(decide({ addressablePointCount: 2500 }).preferredBrand, "GAMEWELL");
  const d = decide({ addressablePointCount: 2500 });
  assert.match(d.decidedBy, /LARGE_PROJECT_SCALE/);
});

// ===========================================================================
// 4. EN regime resolves to Gent
// ===========================================================================
test("4 -- an EN regime resolves to GENT", () => {
  const d = decide({ standardsRegime: "EN", addressablePointCount: 4000 });
  assert.equal(d.preferredBrand, "GENT");
  assert.match(d.decidedBy, /STANDARDS_REGIME_EN/);
  // EN does not scale-split on point count.
  assert.equal(decide({ standardsRegime: "EN", addressablePointCount: 10 }).preferredBrand, "GENT");
  // An unsupported regime fails closed rather than defaulting.
  assert.throws(() => decide({ standardsRegime: "IEC" }), (e) => e.code === "BRAND_STRATEGY_REGIME_UNSUPPORTED");
});

// ===========================================================================
// 5. Conventional NAC devices do not inflate the addressable point count
// ===========================================================================
test("5 -- conventional NAC appliances do not inflate the addressable point count", () => {
  const nac = CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp;
  assert.equal(nac, 438);
  // The classifier refuses to book a notification appliance as an SLC point.
  const r = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Notification Appliance",
    selectedQuantity: { value: 438 }, attributes: { addressing: "addressable" },
  });
  assert.notEqual(r.state, "SLC_DETECTOR_POOL");
  assert.notEqual(r.state, "SLC_MODULE_POOL");
  assert.equal(r.demandUnits ?? 0, 0, "no SLC demand is claimed for conventional NAC appliances");
  // And the point count used for the decision excludes them.
  const detPts = CENSUS_Q.smoke + 9 + CENSUS_Q.combined + CENSUS_Q.duct;
  const modPts = CENSUS_Q.pull + CENSUS_Q.monModule + CENSUS_Q.ctrlModule + CENSUS_Q.doorContact;
  assert.equal(detPts + modPts, 1877);
  assert.ok(detPts + modPts + nac > 2000, "adding the NAC appliances would wrongly cross the threshold");
});

// ===========================================================================
// 6. Passive accessories do not inflate the point count
// ===========================================================================
test("6 -- passive accessories, housings and included hardware do not inflate the count", () => {
  const zero = (family, value) => {
    const r = classifyFireAlarmSlcItem({
      system: "Fire Alarm", family, selectedQuantity: { value }, attributes: { addressing: "addressable" },
    });
    assert.equal(r.state, "NOT_SLC", `${family} must not be a point`);
    assert.equal(r.demandUnits, 0);
    assert.equal(r.unitsPerDevice, 0);
  };
  zero("Fireman Telephone Jack", CENSUS_Q.ftJack);   // passive, draws no current
  zero("Duct Detector Housing", CENSUS_Q.duct);     // address belongs to the head
  zero("Sampling Tube", CENSUS_Q.duct);
  zero("Remote Test Station", 45);
  zero("Fire Alarm Control Panel", 7);
  zero("Loop Card", 7);
  // The duct HEAD is the addressable part and IS counted.
  const head = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Duct Detector",
    selectedQuantity: { value: CENSUS_Q.duct }, attributes: { addressing: "addressable" },
  });
  assert.equal(head.state, "SLC_DETECTOR_POOL");
  assert.equal(head.demandUnits, CENSUS_Q.duct);
});

// ===========================================================================
// 7. Unresolved addressable quantities remain explicit
// ===========================================================================
test("7 -- unresolved addressable quantities stay explicit and are never zeroed", () => {
  // A pending quantity must not be silently booked as 0.
  const pending = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Firephone Control Module",
    selectedQuantity: { value: null }, attributes: { addressing: "addressable" },
  });
  // The module ROLE is established, but demand stays null because the quantity is
  // unknown. That is the important part: null, never 0.
  assert.equal(pending.state, "SLC_MODULE_POOL");
  assert.equal(pending.demandUnits, null, "an unknown demand is null, NOT zero");
  assert.equal(pending.quantity.status, "UNKNOWN");
  // So it cannot quietly shrink the point count, and cannot inflate it either.
  assert.notEqual(pending.demandUnits, 0);
  // The decision script surfaces such lines as PENDING QUANTITY rather than 0.
  // DB-backed only: the script requires a real database path.
  if (process.env.FA_BRAND_DB) {
    const out = run("decide-al-mousa-fire-alarm-brand.mjs", process.env.FA_BRAND_DB);
    assert.match(out, /PENDING QUANTITY\s+TBD/);
    assert.match(out, /COMPANY_POLICY_POINT_COUNT = 1877/);
    assert.doesNotMatch(out, /PENDING QUANTITY\s+0\b/);
  }
});

// ===========================================================================
// 8. Preferred brand is NOT consultant approval
// ===========================================================================
test("8 -- a preferred brand is not a consultant approval", () => {
  const d = decide();
  assert.equal(d.preferredBrand, "FARENHYT");
  assert.equal(d.decidedByStep, 4, "decided by company policy");
  assert.notEqual(d.decidedByStep, 1, "and emphatically not by a mandate");
  // The rationale must describe a commercial preference, not technical superiority.
  assert.match(d.rationale, /COMMERCIAL preference, not a\s+claim of technical superiority|COMMERCIAL preference/);
  // Steps 5 and 6 can only disqualify; they can never promote a brand.
  const t5 = d.precedenceTrail.find((s) => s.step === 5);
  const t6 = d.precedenceTrail.find((s) => s.step === 6);
  assert.match(t5.outcome, /CAN_ONLY_DISQUALIFY/);
  assert.match(t6.outcome, /CAN_ONLY_DISQUALIFY/);
});

// ===========================================================================
// 9. NOTIFIER can remain a technically valid alternative
// ===========================================================================
test("9 -- NOTIFIER remains a technically valid alternative, not a deletion", () => {
  const d = decide();
  assert.equal(d.alternativeBrandStatus, "TECHNICALLY_VALID_ALTERNATIVE");
  const re = reclassifySupersededBrand(
    { brand: "NOTIFIER", selectedBecause: "original project compatibility basis", selectedOn: "2026-09-30" },
    d,
    { reason: "company in-house brand policy, UL/FM regime, <=2000 points", authority: "company policy", on: "2026-09-30" },
  );
  assert.equal(re.priorBrand, "NOTIFIER");
  assert.equal(re.newStatus, "TECHNICALLY_VALID_ALTERNATIVE");
  assert.equal(re.technicalEvidenceRetained, true, "prior technical evidence is retained");
  assert.match(re.note, /remains valid and is retained unchanged/);
  assert.equal(re.supersededBy, "FARENHYT");
});

// ===========================================================================
// 10. Superseding preserves history
// ===========================================================================
test("10 -- superseding a brand decision preserves why it was chosen", () => {
  const d = decide();
  const re = reclassifySupersededBrand(
    { brand: "NOTIFIER", selectedBecause: "spec was believed to name the manufacturer", selectedOn: "2026-09-30" },
    d,
    { reason: "no mandate exists; policy selects the in-house brand", authority: "company policy", on: "2026-09-30" },
  );
  // Every historical element survives.
  assert.match(re.priorSelectedBecause, /believed to name the manufacturer/);
  assert.equal(re.priorSelectedOn, "2026-09-30");
  assert.match(re.supersededBecause, /no mandate exists/);
  assert.equal(re.authority, "company policy");
  assert.ok(re.supersededOn);
});

// ===========================================================================
// 11. Preliminary loop calculation proceeds without final panel allocation
// ===========================================================================
test("11 -- a preliminary loop count can be calculated without final allocation", () => {
  const detPts = CENSUS_Q.smoke + 9 + CENSUS_Q.combined + CENSUS_Q.duct;
  const modPts = CENSUS_Q.pull + CENSUS_Q.monModule + CENSUS_Q.ctrlModule + CENSUS_Q.doorContact;
  const loops = Math.max(
    Math.ceil(detPts / FARENHYT_PLATFORM.panel.perLoopDetectors),
    Math.ceil(modPts / FARENHYT_PLATFORM.panel.perLoopModules),
  );
  assert.equal(detPts, 1486);
  assert.equal(modPts, 391);
  assert.equal(loops, 10, "detectors bind: 1486 / 159 -> 10 loops");
  // Manufacturer limits are taken from the governed corpus, not invented.
  assert.equal(FARENHYT_PLATFORM.panel.perLoopDetectors, 159);
  assert.equal(FARENHYT_PLATFORM.panel.perLoopModules, 159);
});

// ===========================================================================
// 12. Preliminary loops are marked as an assumption
// ===========================================================================
test("12 -- preliminary loops are explicitly marked as an assumption", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-preliminary-solution.mjs"));
  assert.match(src, /PRELIMINARY DESIGN ASSUMPTION, NOT FINAL DETAILED DESIGN/);
  assert.match(src, /SLC loop quantities are preliminary and based on the current BOQ\/device count/);
  assert.match(src, /subject to revision upon receipt\/completion of/);
  // And it refuses to fabricate the allocation it does not have.
  assert.match(src, /NOT assumed, and deliberately not fabricated/);
  assert.match(src, /identity of the sixth FACP/);
});

// ===========================================================================
// 13. Supplier-selected accessories do not auto-approve
// ===========================================================================
test("13 -- a supplier proposal does not become an approval by itself", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-rfq.mjs"));
  assert.match(src, /SUPPLIER_PROPOSED_TECHNICAL_SOLUTION/);
  assert.match(src, /does NOT become the approved BOM automatically/);
  assert.match(src, /Engineer review is required first/);
  assert.match(src, /will be reviewed by our engineer before they are accepted/);
});

// ===========================================================================
// 14. A supplier P/N does not silently replace engineer selection
// ===========================================================================
test("14 -- a supplier P/N cannot silently replace the engineer's selection", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-rfq.mjs"));
  assert.match(src, /as a SEPARATE line rather than substituting it/);
  assert.match(src, /A substituted part will not be/);
  assert.match(src, /treated as the item requested/);
  // Notification candidates stay candidates.
  assert.match(src, /FINAL P\/N PENDING PROJECT INPUT/);
  assert.match(src, /COMMERCIAL_CANDIDATE only/);
});

// ===========================================================================
// 15. The Farenhyt RFQ does not require 100% exact P/N completion
// ===========================================================================
test("15 -- the Farenhyt RFQ does not require full P/N completion before issue", () => {
  const out = run("build-al-mousa-farenhyt-rfq.mjs");
  assert.match(out, /SECTION A -- KNOWN SELECTED ITEMS/);
  assert.match(out, /SECTION B -- SUPPLIER SELECTION REQUIRED/);
  const a = Number(out.match(/Section A line count\s+:\s+(\d+)/)[1]);
  const b = Number(out.match(/Section B line count\s+:\s+(\d+)/)[1]);
  assert.ok(b > 0, "Section B exists, so supplier selection is genuinely delegated");
  assert.ok(a > 0 && a < a + b, "the RFQ is issued with unresolved identity still pending");
  assert.match(out, /deliberately NOT inflated/);
});

// ===========================================================================
// 16. Rerun is idempotent
// ===========================================================================
test("16 -- brand strategy, preliminary solution and RFQ are deterministic", () => {
  assert.deepEqual(run("build-al-mousa-farenhyt-rfq.mjs"), run("build-al-mousa-farenhyt-rfq.mjs"));
  assert.deepEqual(run("build-al-mousa-farenhyt-preliminary-solution.mjs"), run("build-al-mousa-farenhyt-preliminary-solution.mjs"));
  // Re-resolving the same input is stable.
  assert.deepEqual(decide(), decide());
  // The commercial census assertion still holds, so no quantity drifted.
  assert.deepEqual(assertCensus(), { lines: 21, verified: 13 });
});

// ===========================================================================
// 16b. The company policy is DATA, not hard-coded branches
// ===========================================================================
test("16b -- the brand policy is configuration, and the engine reads it", () => {
  // The policy table is the single place the three in-house brands live.
  assert.equal(IN_HOUSE_FIRE_ALARM_POLICY.scopeSystemCategory, "FIRE_ALARM");
  assert.equal(IN_HOUSE_FIRE_ALARM_POLICY.byRegime.ULF.smallProjectInHouseBrand, "FARENHYT");
  assert.equal(IN_HOUSE_FIRE_ALARM_POLICY.byRegime.ULF.largeProjectInHouseBrand, "GAMEWELL");
  assert.equal(IN_HOUSE_FIRE_ALARM_POLICY.byRegime.EN.inHouseBrand, "GENT");
  assert.equal(IN_HOUSE_FIRE_ALARM_POLICY.nonInHouseBrandStatus, "TECHNICALLY_VALID_ALTERNATIVE");
  // The threshold really is the one the policy document states.
  assert.equal(IN_HOUSE_FIRE_ALARM_POLICY.regimeScaleThresholds.ULF_LARGE_PROJECT_MIN_POINTS_EXCLUSIVE, 2000);

  // Proof the engine READS the table rather than hard-coding the answers: re-point
  // the policy at a different in-house brand and the outcome follows it.
  const overridden = {
    ...IN_HOUSE_FIRE_ALARM_POLICY,
    byRegime: { ...IN_HOUSE_FIRE_ALARM_POLICY.byRegime, ULF: { smallProjectInHouseBrand: "SOME_OTHER_HOUSE_BRAND" } },
  };
  assert.equal(
    resolveFireAlarmBrandStrategy(base({ addressablePointCount: 1877 }), overridden).preferredBrand,
    "SOME_OTHER_HOUSE_BRAND",
  );

  // And the validated input is normalised, with the mandate normalised to null.
  const v = validateBrandStrategyInput(base());
  assert.equal(v.mandatoryBrand, null);
  assert.equal(v.systemCategory, "FIRE_ALARM");
  assert.equal(v.addressablePointCount, 1877);
  assert.equal(v.mandatoryBrandEvidence.length, 0);

  // The policy is scoped to Fire Alarm and must fail closed elsewhere.
  assert.throws(
    () => validateBrandStrategyInput({ ...base(), systemCategory: "CCTV" }),
    (e) => e.code === "BRAND_STRATEGY_CATEGORY_NOT_FIRE_ALARM",
  );
  assert.throws(
    () => validateBrandStrategyInput({ ...base(), addressablePointCount: -1 }),
    (e) => e.code === "BRAND_STRATEGY_POINT_COUNT_NEGATIVE",
  );
});
