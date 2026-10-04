// PRODUCT FAMILY SCORING CONTRACT TESTS.
//
// `productFamily` is a GOVERNED taxonomy field in production
// (app/domain/fire-alarm-taxonomy.mjs -> FIRE_ALARM_TAXONOMY, 52 families), so it
// is scored by production-resolved family identity rather than string identity.
//
// The defect this exists to prevent: the benchmark scored "Addressable Smoke
// Detector" WRONG against a key of "Addressable Optical Smoke Detector". That is
// a benchmark-contract error -- the model was charged for the answer key's own
// extra wording -- and it is the same class of bug as the earlier hidden-field and
// undisclosed-sentinel defects.
//
// The counter-risk is just as serious: a permissive equivalence layer that
// collapses Smoke into Heat, or a Sounder/Strobe into a bare Strobe, would hide
// REAL classification errors and make a weak model look strong. Every test below
// therefore pins BOTH directions.
import test from "node:test";
import assert from "node:assert/strict";

import { FIRE_ALARM_TAXONOMY, isFireAlarmFamilySynonym, normalizeFireAlarmFamily } from "../app/domain/fire-alarm-taxonomy.mjs";
import {
  DISTINGUISHING_TOKENS,
  canonicalizeFamily,
  familyEquivalence,
  governedFamilyVocabulary,
} from "./fixtures/ai-synthetic/boq-family-equivalence.mjs";
import {
  KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES,
  PRODUCT_FAMILY_VOCABULARY,
  buildCanonicalBenchmarkPrompt,
  lastProductFamilyAudit,
  verifyBenchmarkContract,
} from "./fixtures/ai-synthetic/boq-benchmark-contract.mjs";
import { BOQ_UNDERSTANDING_CASES } from "./fixtures/ai-synthetic/boq-understanding-corpus.mjs";
import { scoreUnderstandingCase } from "./fixtures/ai-synthetic/boq-understanding-scorer.mjs";

// ── A. alias / presentation variants production says ARE the same family ─────

test("A: production-resolved alias variants are the SAME family", () => {
  const mustBeEquivalent = [
    // Production resolves both to "Addressable Smoke Detector". MEASURED:
    // "optical" is governed by NO family in production, so it is a qualifier.
    ["Addressable Optical Smoke Detector", "Addressable Smoke Detector"],
    ["Sounder Strobe", "Sounder/Strobe"],
    ["Remote Annunciator", "Annunciator"],
    // Production's ONE declared synonym group.
    ["Manual Call Point", "Pull Station"],
  ];
  for (const [a, b] of mustBeEquivalent) {
    const r = familyEquivalence(a, b);
    assert.equal(r.equivalent, true, `${a} should equal ${b} (got ${r.basis}: ${r.reason})`);
  }
});

test("A: presentation-only words never change family identity", () => {
  // "assy."/"assembly"/"kit" carry no engineering meaning.
  for (const variant of ["Sounder/Strobe", "Sounder/Strobe assy.", "Sounder Strobe assembly", "Sounder/Strobe kit"]) {
    const r = familyEquivalence("Sounder/Strobe", variant);
    assert.equal(r.equivalent, true, `${variant} should equal Sounder/Strobe (${r.basis})`);
  }
});

test("A: the motivating case -- 'Snd/Strobe assy.' is NOT a Sounder/Strobe", () => {
  // Asserted explicitly because it is the case that opened this slice, and
  // because the intuitive answer is WRONG. MEASURED in production:
  //   normalizeFireAlarmFamily("Snd/Strobe assy.")  -> null
  //   classifyFireAlarmFamilyFromText(...)         -> "Strobe"  (sounder DROPPED)
  // "snd" appears in NO governed phrase list, and dropping the audible half turns
  // an audible+visual appliance into a visual-only one. Production therefore does
  // NOT establish this equivalence, so the benchmark must not grant it.
  assert.equal(normalizeFireAlarmFamily("Snd/Strobe assy."), null);
  const r = familyEquivalence("Sounder Strobe", "Snd/Strobe assy.");
  assert.equal(r.equivalent, false);
  assert.equal(r.basis, "DISTINGUISHING_TOKEN_CONFLICT");
  assert.ok(r.conflictingTokens.includes("sounder"));
});

// ── B. genuinely different families must FAIL ────────────────────────────────

test("B: materially different equipment families are NOT equivalent", () => {
  const mustDiffer = [
    ["Addressable Smoke Detector", "Addressable Heat Detector"],
    ["Conventional Smoke Detector", "Conventional Heat Detector"],
    ["Monitor Module", "Control Module"],
    ["Fire Alarm Control Panel", "Annunciator"],
    ["Sounder/Strobe", "Strobe"],
    ["Sounder", "Bell"],
    ["Addressable Detector", "Conventional Detector"],
    ["Detector Base", "Sounder Base"],
  ];
  for (const [a, b] of mustDiffer) {
    assert.equal(familyEquivalence(a, b).equivalent, false, `${a} must NOT equal ${b}`);
  }
});

test("B: the scorer's productFamily verdict matches the equivalence layer", () => {
  // Proves the equivalence decision is actually WIRED into scoring, not merely
  // reachable in isolation -- the exact "code references it" failure mode.
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.caseId === "SYN-U-001");
  assert.ok(c, "SYN-U-001 must exist");

  const aliasAnswer = { ...c.expected, productFamily: "Addressable Smoke Detector" };
  const aliased = scoreUnderstandingCase({ caseSpec: c, predicted: { ...aliasAnswer, reviewState: "READY" } });
  assert.ok(
    !aliased.wrongFields.some((w) => w.field === "productFamily"),
    "a production-equivalent family alias must not be scored wrong",
  );

  const wrongAnswer = { ...c.expected, productFamily: "Annunciator" };
  const wrong = scoreUnderstandingCase({ caseSpec: c, predicted: { ...wrongAnswer, reviewState: "READY" } });
  const pf = wrong.wrongFields.find((w) => w.field === "productFamily");
  assert.ok(pf, "a materially different family must still be scored wrong");
  assert.equal(pf.familyBasis, "DISTINGUISHING_TOKEN_CONFLICT");
});

// ── C. UNKNOWN never equals a known family ──────────────────────────────────

test("C: UNKNOWN is never equal to a known family", () => {
  for (const unknownish of ["UNKNOWN", null, "", "n/a", "not specified", "-", "?"]) {
    const r = familyEquivalence("Sounder", unknownish);
    assert.equal(r.equivalent, false, `Sounder must not equal ${JSON.stringify(unknownish)}`);
    assert.equal(r.basis, "GOT_UNKNOWN");
  }
  // And two unknowns are not a correct identification either.
  assert.equal(familyEquivalence("UNKNOWN", "UNKNOWN").equivalent, false);
  assert.equal(familyEquivalence(null, null).equivalent, false);
  assert.equal(familyEquivalence("Sounder", "UNKNOWN").basis, "GOT_UNKNOWN");
  // Ground truth with no family + a concrete answer is an unsupported inference.
  assert.equal(familyEquivalence(null, "Sounder").basis, "EXPECTED_UNKNOWN");
});

test("C: a model returning UNKNOWN for a stated family still loses the field", () => {
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.expected?.productFamily);
  const answer = { ...c.expected, productFamily: "UNKNOWN" };
  const r = scoreUnderstandingCase({ caseSpec: c, predicted: { ...answer, reviewState: "READY" } });
  assert.ok(r.wrongFields.some((w) => w.field === "productFamily"), "UNKNOWN must not pass as a stated family");
});

// ── D. null vs UNKNOWN equivalence is a DECLARED contract decision ───────────

test("D: null and UNKNOWN are equivalent ONLY because the contract declares it", () => {
  // The canonical benchmark prompt instructs the model to emit the string
  // "UNKNOWN" for an unstated text field, while ground truth stores null. Those
  // two MUST be treated as the same answer, or every compliant model fails every
  // unstated field. The equivalence is deliberate and lives in ONE place
  // (`isUnknown`), shared by the scorer, the predicates and the contract
  // validator, so the three can never drift apart.
  for (const a of [null, "UNKNOWN", "unknown", " n/a ", ""]) {
    for (const b of [null, "UNKNOWN", "unknown", "n/a", ""]) {
      const expectedEq = true;
      const r = familyEquivalence("Sounder", a);
      assert.equal(r.equivalent, false, `a known family never equals ${JSON.stringify(a)} regardless`);
      // The declared part: the scorer must treat them identically as UNKNOWN.
      const c = { caseId: "T", difficulty: "d", expected: { productFamily: null }, mustRemainUnknown: ["productFamily"] };
      const pred = { productFamily: b, reviewState: "READY" };
      const s = scoreUnderstandingCase({ caseSpec: c, predicted: pred });
      assert.equal(s.fabricatedFields.length, 0, `${JSON.stringify(b)} must not read as a fabrication`);
      void expectedEq;
    }
  }
});

// ── E. addressing-mode and other engineering distinctions are preserved ──────

test("E: addressing mode is never normalised away", () => {
  assert.equal(familyEquivalence("Addressable Detector", "Conventional Detector").equivalent, false);
  // MEASURED: production's own resolver is lossy here -- both
  // "conventional smoke detector" and "conventional heat detector" resolve to
  // "Conventional Detector". The veto must refuse that collapse.
  assert.equal(normalizeFireAlarmFamily("conventional smoke detector"), "Conventional Detector");
  assert.equal(normalizeFireAlarmFamily("conventional heat detector"), "Conventional Detector");
  assert.equal(familyEquivalence("Conventional Smoke Detector", "Conventional Heat Detector").equivalent, false);
  // Addressable smoke vs heat ARE distinct in production too, so both layers agree.
  assert.notEqual(normalizeFireAlarmFamily("addressable smoke detector"), normalizeFireAlarmFamily("addressable heat detector"));
});

test("E: every distinguishing token is genuinely load-bearing", () => {
  // Each token must be able to separate two real forms. The property that matters
  // is DISCRIMINATION between strings, not how many governed family NAMES contain
  // the token -- production has exactly one family containing "smoke"
  // ("Addressable Smoke Detector"), yet "smoke" is still load-bearing because it
  // separates an addressable smoke detector from an addressable heat detector.
  const separations = [
    ["smoke", "Addressable Smoke Detector", "Addressable Heat Detector"],
    ["heat", "Addressable Smoke Detector", "Addressable Heat Detector"],
    ["addressable", "Addressable Detector", "Conventional Detector"],
    ["conventional", "Addressable Detector", "Conventional Detector"],
    ["sounder", "Sounder/Strobe", "Strobe"],
    ["strobe", "Sounder/Strobe", "Sounder"],
    ["monitor", "Monitor Module", "Control Module"],
    ["control", "Monitor Module", "Control Module"],
    ["isolator", "Isolator Module", "Monitor Module"],
    ["annunciator", "Annunciator", "Fire Alarm Control Panel"],
  ];
  for (const [token, withToken, withoutToken] of separations) {
    assert.ok(DISTINGUISHING_TOKENS.includes(token), `"${token}" must be a distinguishing token`);
    const r = familyEquivalence(withToken, withoutToken);
    assert.equal(r.equivalent, false, `${withToken} vs ${withoutToken} must differ`);
    assert.ok(r.conflictingTokens.includes(token), `expected "${token}" to be the reported conflict, got ${JSON.stringify(r.conflictingTokens)}`);
  }
  // "optical" must NOT be a distinguishing token: production governs no optical
  // family, and treating it as one would recreate the original over-strictness.
  assert.ok(!DISTINGUISHING_TOKENS.includes("optical"), '"optical" is governed by no production family and must not discriminate');
  assert.equal(canonicalizeFamily("Addressable Optical Smoke Detector").canonical, "Addressable Smoke Detector");
});

// ── F. no benchmark-only alias can be smuggled in ───────────────────────────

test("F: the scored vocabulary IS production's vocabulary, read not copied", () => {
  const production = Object.entries(FIRE_ALARM_TAXONOMY).flatMap(([, families]) => families);
  assert.deepEqual(
    [...PRODUCT_FAMILY_VOCABULARY].sort(),
    [...production].sort(),
    "the benchmark's productFamily vocabulary must equal production's, exactly",
  );
  // And it is read live, so a taxonomy change cannot leave a stale copy behind.
  assert.deepEqual(
    [...PRODUCT_FAMILY_VOCABULARY].sort(),
    governedFamilyVocabulary().map((e) => e.family).sort(),
  );
});

test("F: an ungoverned string gets NO equivalence credit by default", () => {
  // A benchmark-only alias would have to be added to production to pass. Proved by
  // showing two ungoverned strings are equivalent ONLY when token-identical.
  assert.equal(familyEquivalence("Widget Assembly A", "Widget Assembly A").equivalent, true);
  assert.equal(familyEquivalence("Widget Assembly A", "Widget Assembly B").equivalent, false);
  assert.equal(familyEquivalence("Totally Made Up Family", "Sounder/Strobe").equivalent, false);
  assert.equal(canonicalizeFamily("Totally Made Up Family").basis, "UNRESOLVED_BY_PRODUCTION");
});

test("F: synonym equivalence is limited to production's declared groups", () => {
  // Only Manual Call Point / Pull Station is declared. If production ever adds a
  // group, this test still holds because it asserts the layer never invents one.
  assert.equal(isFireAlarmFamilySynonym("Manual Call Point", "Pull Station"), true);
  assert.equal(isFireAlarmFamilySynonym("Sounder", "Bell"), false);
  assert.equal(familyEquivalence("Sounder", "Bell").equivalent, false);
  // The layer must contain NO similarity threshold: high token overlap alone never
  // grants equivalence when production resolves the two forms to different
  // families. A device and its mounting base share most of their tokens.
  const base = familyEquivalence("Addressable Smoke Detector", "Addressable Smoke Detector Base");
  assert.equal(base.equivalent, false);
  assert.equal(base.basis, "DIFFERENT_CANONICAL_FAMILY");
  // The device side resolves to a governed family; the base side does not resolve
  // to that family, so they cannot be equivalent. Production has no governed family
  // for this base string, which is precisely why no credit is granted.
  assert.equal(base.expectedCanonical, "Addressable Smoke Detector");
  assert.notEqual(base.gotCanonical, "Addressable Smoke Detector");
  // Plural of the same device IS the same family -- production's classifier
  // resolves it, and refusing it would be over-strictness, not rigor.
  assert.equal(familyEquivalence("Addressable Smoke Detector", "Addressable Smoke Detectors").basis, "PRODUCTION_SAME_CANONICAL");
});

// ── contract gate: the disclosed corpus gap is pinned, not hidden ────────────

test("F: the ungoverned ground-truth gap is CLOSED, and the check stays enforced", () => {
  verifyBenchmarkContract();
  assert.ok(lastProductFamilyAudit, "the contract must publish a productFamily audit");
  assert.equal(lastProductFamilyAudit.unexpected.length, 0, "an ungoverned ground-truth family must fail the gate");
  assert.equal(lastProductFamilyAudit.governedCount, PRODUCT_FAMILY_VOCABULARY.length);
  // CLOSED 2026-10-02 by human decision. Previously 6 distinct families across 8
  // case-instances made 22.2% of the corpus unwinnable. The CHECK IS RETAINED, not
  // removed: an empty list is the healthy state, and a regression must still fail.
  assert.deepEqual(lastProductFamilyAudit.disclosedKnownGap, [], "no ground-truth family may remain ungoverned");
  assert.deepEqual([...KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES], []);

  // Prove the gate still bites if an ungoverned family reappears.
  const victim = {
    ...BOQ_UNDERSTANDING_CASES[0],
    caseId: "SYN-REG-001",
    expected: { ...BOQ_UNDERSTANDING_CASES[0].expected, productFamily: "Totally Ungoverned Widget" },
  };
  assert.throws(
    () => verifyBenchmarkContract({ corpus: [...BOQ_UNDERSTANDING_CASES, victim] }),
    (e) => e.code === "BENCHMARK_CONTRACT_VIOLATION" && /does not govern/.test(e.message),
    "the closed-gap gate must still reject a re-opened ungoverned family",
  );
});

test("F: the prompt discloses every governed family and no invented one", () => {
  const prompt = buildCanonicalBenchmarkPrompt({ input: "x" });
  for (const family of PRODUCT_FAMILY_VOCABULARY) {
    assert.ok(prompt.includes(family), `prompt omits governed family "${family}"`);
  }
  for (const known of KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES) {
    // A pinned gap must NOT be advertised to models as if it were a valid answer.
    assert.ok(!prompt.includes(`- ${known}\n`), `prompt must not offer ungoverned family "${known}"`);
  }
});
