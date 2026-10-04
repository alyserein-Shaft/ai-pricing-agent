// CATEGORY SCORING CONTRACT TESTS.
//
// `category` is a CLOSED 7-value governed vocabulary in production. MEASURED:
// `normalizeFireAlarmCategory` accepts only the exact governed names plus a small
// alias set ("detection device", "notification device", "notification appliance"),
// and ALL EIGHT category values the benchmark previously used returned null -- two
// of them ("Annunciator", "Control Panel") were FAMILY names, so the benchmark had
// conflated the two taxonomy levels. categoryAccuracy was therefore scoring an
// invented vocabulary and was not trustworthy.
//
// Both directions are pinned: production-supported aliases must pass, and
// materially different categories must still fail.
import test from "node:test";
import assert from "node:assert/strict";

import { FIRE_ALARM_TAXONOMY, normalizeFireAlarmCategory } from "../app/domain/fire-alarm-taxonomy.mjs";
import {
  canonicalizeCategory,
  categoryScoringVerdict,
  governedCategoryVocabulary,
} from "./fixtures/ai-synthetic/boq-family-equivalence.mjs";
import {
  CATEGORY_VOCABULARY,
  KNOWN_UNGOVERNED_EXPECTED_CATEGORIES,
  buildCanonicalBenchmarkPrompt,
  lastCategoryAudit,
  verifyBenchmarkContract,
} from "./fixtures/ai-synthetic/boq-benchmark-contract.mjs";
import { BOQ_UNDERSTANDING_CASES } from "./fixtures/ai-synthetic/boq-understanding-corpus.mjs";
import { scoreUnderstandingCase } from "./fixtures/ai-synthetic/boq-understanding-scorer.mjs";

// ── A. the governed vocabulary is disclosed to the model contract ────────────

test("A: the contract discloses exactly production's governed categories", () => {
  assert.deepEqual([...CATEGORY_VOCABULARY].sort(), Object.keys(FIRE_ALARM_TAXONOMY).sort());
  // The count is DERIVED from the live taxonomy, never pinned to a literal.
  // A pinned literal could only detect "the number changed"; it could not
  // detect a category that was silently emptied, which is the real risk this
  // gate exists to prevent. The two invariants below are strictly stronger:
  // the contract must equal the live taxonomy exactly, AND every governed
  // category must still carry at least one family.
  const liveCount = Object.keys(FIRE_ALARM_TAXONOMY).length;
  assert.equal(CATEGORY_VOCABULARY.length, liveCount);
  for (const [category, families] of Object.entries(FIRE_ALARM_TAXONOMY)) {
    assert.ok(families.length > 0, `governed category "${category}" has no families`);
    assert.ok(CATEGORY_VOCABULARY.includes(category), `contract omits governed category "${category}"`);
  }
  const prompt = buildCanonicalBenchmarkPrompt({ input: "x" });
  for (const category of CATEGORY_VOCABULARY) {
    assert.ok(prompt.includes(category), `prompt omits governed category "${category}"`);
  }
  // Read live, never hand-copied, so a taxonomy change cannot leave a stale list.
  assert.deepEqual([...CATEGORY_VOCABULARY].sort(), [...governedCategoryVocabulary()].sort());
});

// ── B. valid canonical categories score correctly ───────────────────────────

test("B: a canonical category is scored correct through the real scorer", () => {
  for (const category of CATEGORY_VOCABULARY) {
    const verdict = categoryScoringVerdict(category, category);
    assert.equal(verdict.correct, true, `${category} must equal itself`);
    assert.equal(verdict.basis, "PRODUCTION_SAME_CATEGORY");
  }
  // And the verdict is WIRED into scoring, not merely reachable in isolation.
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.expected?.category);
  assert.ok(c, "a case with a category must exist");
  const pred = { ...c.expected, reviewState: "READY" };
  const r = scoreUnderstandingCase({ caseSpec: c, predicted: pred });
  assert.ok(!r.wrongFields.some((w) => w.field === "category"), "ground truth must not fail its own category");
});

// ── C. aliases normalise ONLY where production supports them ────────────────

test("C: production-supported category aliases are equivalent", () => {
  // MEASURED against production's own exactCategoryAliases.
  const supported = [
    ["Detection Devices", "detection device"],
    ["Notification Devices", "notification device"],
    ["Notification Devices", "notification appliance"],
    ["Control Equipment", "control equipment"],
  ];
  for (const [canonical, alias] of supported) {
    const v = categoryScoringVerdict(canonical, alias);
    assert.equal(v.correct, true, `${alias} should normalise to ${canonical} (${v.basis})`);
  }
});

test("C: the benchmark's OLD category values are NOT production aliases", () => {
  // This is the defect being closed. If any of these ever normalise, the contract
  // gate would have been wrong to reject them -- so pin that they do not.
  for (const old of ["Detector", "Notification", "Control Panel", "Peripheral", "Module", "Annunciator", "Accessory", "Cable"]) {
    assert.equal(normalizeFireAlarmCategory(old), null, `${old} unexpectedly became a supported alias`);
    assert.equal(canonicalizeCategory(old).basis, "OFF_CONTRACT");
  }
});

// ── D. materially different categories still fail ───────────────────────────

test("D: different governed categories are never equivalent", () => {
  const governed = [...CATEGORY_VOCABULARY];
  for (const a of governed) {
    for (const b of governed) {
      if (a === b) continue;
      assert.equal(categoryScoringVerdict(a, b).correct, false, `${a} must not equal ${b}`);
    }
  }
  // In particular the conflated family/category pairs must stay apart.
  for (const [cat, fam] of [["Control Equipment", "Annunciator"], ["Control Equipment", "Control Panel"], ["Accessories", "Accessory"]]) {
    assert.equal(categoryScoringVerdict(cat, fam).correct, false, `category ${cat} must not absorb family ${fam}`);
  }
});

// ── E. UNKNOWN / null handling follows the production contract ──────────────

test("E: UNKNOWN is never equal to a governed category", () => {
  for (const unknownish of ["UNKNOWN", null, "", "n/a", "not specified", "-", "?"]) {
    const v = categoryScoringVerdict("Detection Devices", unknownish);
    assert.equal(v.correct, false, `a governed category must not equal ${JSON.stringify(unknownish)}`);
    assert.equal(v.basis, "GOT_UNKNOWN");
  }
  // Two unknowns are a correct preserved answer on the correctness axis; the
  // separate mustRemainUnknown axis is what penalises a fabricated value.
  assert.equal(categoryScoringVerdict(null, "UNKNOWN").correct, true);
  assert.equal(categoryScoringVerdict(null, null).correct, true);
  assert.equal(categoryScoringVerdict(null, "Bell").basis, "EXPECTED_UNKNOWN");
});

test("E: a model returning UNKNOWN for a determinate category still loses the field", () => {
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.expected?.category);
  const r = scoreUnderstandingCase({ caseSpec: c, predicted: { ...c.expected, category: "UNKNOWN", reviewState: "READY" } });
  assert.ok(r.wrongFields.some((w) => w.field === "category"), "UNKNOWN must not pass as a determinate category");
});

// ── F. no off-taxonomy expected category can enter the corpus silently ──────

test("F: the category gate rejects an off-taxonomy ground-truth value", () => {
  verifyBenchmarkContract();
  assert.ok(lastCategoryAudit, "the contract must publish a category audit");
  assert.equal(lastCategoryAudit.governedCount, Object.keys(FIRE_ALARM_TAXONOMY).length);
  assert.deepEqual(lastCategoryAudit.unexpected, [], "no off-taxonomy category may remain");
  assert.deepEqual([...KNOWN_UNGOVERNED_EXPECTED_CATEGORIES], [], "the disclosed category gap is empty");
  assert.deepEqual(lastCategoryAudit.disclosedKnownGap, []);

  // The check must still bite.
  const victim = {
    ...BOQ_UNDERSTANDING_CASES[0],
    caseId: "SYN-CAT-REG-001",
    expected: { ...BOQ_UNDERSTANDING_CASES[0].expected, category: "Detector" },
  };
  assert.throws(
    () => verifyBenchmarkContract({ corpus: [...BOQ_UNDERSTANDING_CASES, victim] }),
    (e) => e.code === "BENCHMARK_CONTRACT_VIOLATION" && /category values production does not govern/.test(e.message),
    "the category gate must reject a re-opened off-contract value",
  );
});

test("F: every ground-truth category is either governed or deliberately null", () => {
  const governed = new Set(CATEGORY_VOCABULARY);
  for (const c of BOQ_UNDERSTANDING_CASES) {
    const cat = c.expected?.category ?? null;
    if (cat === null) continue;
    assert.ok(governed.has(cat), `${c.caseId} has off-taxonomy category "${cat}"`);
  }
  // The one deliberate gap is documented rather than forced.
  const gap = BOQ_UNDERSTANDING_CASES.find((c) => c.caseId === "SYN-U-180");
  assert.equal(gap.expected.category, null, "a cable has no governed category and must not be forced");
  assert.equal(gap.expected.productFamily, null, "and no governed family either");
});
