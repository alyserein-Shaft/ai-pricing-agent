#!/usr/bin/env node
/**
 * Fire Alarm Golden Evaluation Gate -- Fire Alarm MVP v1 release gate.
 *
 * Runs the CURRENT product-matching engine (app/domain/product-matching-engine.mjs)
 * against the two frozen Golden projects -- Central Kitchen - Makkah
 * (tests/golden/central-kitchen.fixture.mjs, evaluated against its own
 * live-persisted, requirement-profile-aware evidence) and Opera Block
 * Townhouses (tests/golden/opera-block.fixture.mjs, evaluated against a real
 * issued historical quotation) -- and fails (non-zero exit) if matching
 * quality has regressed against the frozen v1 baseline.
 *
 * This is NOT the same thing as `node --test tests/*.test.mjs`. That suite's
 * 51 pre-existing, already-known failures (infrastructure/unrelated-area
 * gaps, tracked separately -- see docs/fire-alarm-mvp-v1-baseline.md) are
 * NEVER read or reported by this script, and a Golden Evaluation failure
 * must never be confused with one of those. Run both separately.
 *
 * Usage:
 *   node scripts/fire-alarm-golden-evaluation-gate.mjs [--db <path-to-d1-sqlite>] [--json]
 *
 * Exit code 0 = gate passed. Exit code 1 = gate failed (see "GATE FAILURES"
 * in the report) or a Golden project's evidence could not be loaded at all
 * (fails closed -- a missing/unreadable snapshot is never treated as a pass).
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { buildFireAlarmTaxonomyContext } from "../app/domain/fire-alarm-taxonomy.mjs";
import { CENTRAL_KITCHEN_GOLDEN_LINES, CENTRAL_KITCHEN_EXPECTED_BASELINE } from "../tests/golden/central-kitchen.fixture.mjs";
import { OPERA_BLOCK_GOLDEN_LINES, OPERA_BLOCK_EXPECTED_BASELINE } from "../tests/golden/opera-block.fixture.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const asJson = args.includes("--json");
// The live, machine-local Miniflare D1 snapshot vite/wrangler dev actually
// reads and writes (gitignored, never committed -- see .gitignore). This is
// deliberately NOT the stale root-level snapshot some earlier scripts
// default to; pass --db to point at a CI-provided snapshot instead.
const DEFAULT_DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const dbPath = flag("--db", DEFAULT_DB);
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normPart = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function loadCatalog(path) {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const products = db.prepare(`
      SELECT p.id, m.name manufacturer, b.name brand, f.name family, p.part_number partNumber,
             p.normalized_part_number normalizedPartNumber, p.description, p.lifecycle_status lifecycleStatus,
             p.attributes, p.standards, p.review_status reviewStatus
      FROM library_products p
      JOIN product_manufacturers m ON m.id = p.manufacturer_id
      LEFT JOIN product_brands b ON b.id = p.brand_id
      LEFT JOIN product_families f ON f.id = p.family_id
      WHERE p.identity_status <> 'Superseded'
    `).all().map((row) => ({ ...row, attributes: JSON.parse(row.attributes || "[]"), standards: JSON.parse(row.standards || "[]"), compatibility: [], accessories: [] }));
    return { db, products };
  } catch (error) {
    db.close();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Central Kitchen: evaluated against its own live-persisted, requirement-
// profile-aware evidence (approved BOQ understanding + confirmed
// specification requirements already baked into requirement_profile_versions.profile),
// re-run through the CURRENT runProductMatching so the gate proves
// reproducibility with today's code, not just today's cached candidates.
// ---------------------------------------------------------------------------
function evaluateCentralKitchen(db, products) {
  const results = [];
  for (const line of CENTRAL_KITCHEN_GOLDEN_LINES) {
    const row = db.prepare("SELECT profile FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL").get(line.boqItemId);
    if (!row) { results.push({ line, error: "NO_PERSISTED_REQUIREMENT_PROFILE" }); continue; }
    const profile = JSON.parse(row.profile);
    const matching = runProductMatching({ profile, products, prices: [] });
    results.push({ line, profile, matching });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Opera Block: evaluated the same way it always has been -- a minimal,
// description-only search profile built via the same deterministic
// taxonomy classifier the real pipeline uses ahead of AI understanding
// (buildFireAlarmTaxonomyContext), matching scripts/regression-opera-block-fas.mjs's
// own buildProfile(). No live project/approval state exists for Opera in
// this repo; its ground truth is the issued historical quotation itself.
// ---------------------------------------------------------------------------
function evaluateOpera(products) {
  const results = [];
  for (const line of OPERA_BLOCK_GOLDEN_LINES) {
    const taxonomyContext = buildFireAlarmTaxonomyContext({ description: line.description });
    const selected = taxonomyContext.families[0] || null;
    const profile = {
      versionNumber: 1,
      boqItem: { id: `opera-sn-${line.sn}`, description: line.description, system: taxonomyContext.system || "Fire Alarm", category: selected?.category || null, productFamily: selected?.family || null },
      readiness: { status: "Ready with Warnings", blockingReasons: [] },
      consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
    };
    const matching = runProductMatching({ profile, products, prices: [] });
    results.push({ line, profile, matching });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Per-line judgment, shared by both projects. A candidate is "acceptable"
// if its part number is in the fixture's own acceptablePartNumbers, OR (when
// that list is intentionally empty -- an honestly-unverified line) if it
// shares the expected governed family and has zero mandatory failures.
// ---------------------------------------------------------------------------
function judgeLine(entry) {
  const { line, matching, error } = entry;
  if (error) return { ...entry, judgment: { loadError: error } };
  const candidates = matching.candidates || [];
  const acceptableSet = new Set((line.acceptablePartNumbers || []).map(normPart));
  const isAcceptable = (candidate) => acceptableSet.size
    ? acceptableSet.has(normPart(candidate.product.partNumber))
    : (line.expectedFamily && norm(candidate.product.family) === norm(line.expectedFamily) && !candidate.mandatoryFailures.length);

  const familyMatch = line.expectedFamily == null || norm(entry.profile.boqItem.productFamily) === norm(line.expectedFamily);
  const firstAcceptableIndex = candidates.findIndex(isAcceptable);
  const aboveFirstAcceptable = firstAcceptableIndex === -1 ? candidates : candidates.slice(0, firstAcceptableIndex);
  // A "true matching error": something ranks above every acceptable
  // candidate that is NOT itself acceptable and NOT merely tied on tier
  // (i.e. it is a wrong-family or otherwise invalid candidate that beat a
  // valid one), exactly the Turn D/E/F/G evaluation framework's definition.
  const trueMatchingError = firstAcceptableIndex > 0 && aboveFirstAcceptable.some((c) => (c.familyMatchTier ?? 0) > (candidates[firstAcceptableIndex]?.familyMatchTier ?? 0));
  const crossFamilyRankingError = firstAcceptableIndex > 0 && aboveFirstAcceptable.some((c) => (c.familyMatchTier ?? 0) === 2);
  const hasCandidate = candidates.length > 0;
  const top1 = candidates[0] || null;
  const top1Acceptable = top1 ? isAcceptable(top1) : false;
  const top1MandatoryClean = top1 ? !top1.mandatoryFailures.length : false;

  // A "false resolve": the fixture says this line is genuinely unresolved
  // (ENGINEER_REVIEW_REQUIRED / NO_MATCH_OR_MISSING_EVIDENCE) but the engine
  // presents a SINGLE, mandatory-clean, uniquely-scored top candidate as if
  // it were a confident, resolved answer -- silently hiding the ambiguity.
  const secondCandidate = candidates[1] || null;
  const looksSingularlyResolved = top1MandatoryClean && (!secondCandidate || secondCandidate.score < top1.score || (secondCandidate.familyMatchTier ?? 0) > (top1.familyMatchTier ?? 0));
  const falseResolve = line.expectedFinalState !== "RESOLVED" && top1Acceptable && looksSingularlyResolved;
  // Correct engineer-review: for a fixture-genuine-ambiguity line, the
  // engine must NOT falsely resolve it (see above) -- ambiguity remaining
  // visible (a tie, or no single confident top candidate) is the CORRECT,
  // expected behavior, not a defect.
  const correctEngineerReview = line.expectedFinalState === "RESOLVED" ? null : !falseResolve;

  // Mandatory-requirement validation correctness: does every fixture-declared
  // must-fail/must-pass expectation match the live computed result?
  const mandatoryChecks = (line.expectedMandatoryOutcomes || []).filter((entry) => entry.mustFailAddressing || entry.mustFail).map((expected) => {
    const candidate = candidates.find((c) => normPart(c.product.partNumber) === normPart(expected.partNumber));
    const actuallyFails = candidate ? candidate.mandatoryFailures.length > 0 : null;
    return { partNumber: expected.partNumber, expectedToFail: true, candidateFound: Boolean(candidate), actuallyFails, correct: candidate ? actuallyFails === true : false };
  });

  return {
    ...entry,
    judgment: {
      familyMatch, computedFamily: entry.profile.boqItem.productFamily,
      hasCandidate, top1PartNumber: top1?.product.partNumber || null, top1Acceptable, top1MandatoryClean,
      trueMatchingError, crossFamilyRankingError, falseResolve, correctEngineerReview,
      mandatoryChecks,
    },
  };
}

function summarize(label, judged) {
  const n = judged.length;
  const loaded = judged.filter((j) => !j.judgment.loadError);
  const familyCorrect = loaded.filter((j) => j.judgment.familyMatch).length;
  const discovered = loaded.filter((j) => j.judgment.hasCandidate).length;
  const acceptable = loaded.filter((j) => !j.judgment.trueMatchingError).length;
  const trueErrors = loaded.filter((j) => j.judgment.trueMatchingError);
  const crossFamilyErrors = loaded.filter((j) => j.judgment.crossFamilyRankingError);
  const falseResolves = loaded.filter((j) => j.judgment.falseResolve);
  const reviewLines = loaded.filter((j) => j.judgment.correctEngineerReview !== null);
  const correctReview = reviewLines.filter((j) => j.judgment.correctEngineerReview).length;
  const mandatoryChecks = loaded.flatMap((j) => j.judgment.mandatoryChecks);
  const mandatoryCorrect = mandatoryChecks.filter((m) => m.correct).length;
  return {
    label, lines: n, loadErrors: n - loaded.length,
    boqExtractionCoverage: `${loaded.length}/${n}`,
    familyClassificationAccuracy: loaded.length ? `${familyCorrect}/${loaded.length} (${(familyCorrect / loaded.length * 100).toFixed(1)}%)` : "N/A",
    candidateDiscoveryCoverage: loaded.length ? `${discovered}/${loaded.length} (${(discovered / loaded.length * 100).toFixed(1)}%)` : "N/A",
    acceptableCandidateSetRate: loaded.length ? `${acceptable}/${loaded.length} (${(acceptable / loaded.length * 100).toFixed(1)}%)` : "N/A",
    trueMatchingErrorCount: trueErrors.length,
    trueMatchingErrorLines: trueErrors.map((j) => j.line.itemRef || j.line.sn),
    falseResolveCount: falseResolves.length,
    falseResolveLines: falseResolves.map((j) => j.line.itemRef || j.line.sn),
    crossFamilyRankingErrorCount: crossFamilyErrors.length,
    crossFamilyRankingErrorLines: crossFamilyErrors.map((j) => j.line.itemRef || j.line.sn),
    mandatoryRequirementValidationCorrectness: mandatoryChecks.length ? `${mandatoryCorrect}/${mandatoryChecks.length} (${(mandatoryCorrect / mandatoryChecks.length * 100).toFixed(1)}%)` : "N/A (no mandatory-outcome assertions in this project)",
    correctEngineerReviewRate: reviewLines.length ? `${correctReview}/${reviewLines.length} (${(correctReview / reviewLines.length * 100).toFixed(1)}%)` : "N/A",
    // Secondary/informational only, per the Fire Alarm MVP v1 baseline
    // philosophy -- never a gate condition.
    historicalTop1InformationalRate: (() => {
      const withHistory = loaded.filter((j) => j.line.historicalPNIsGroundTruth && j.line.historicalPartNumber);
      const hit = withHistory.filter((j) => normPart(j.judgment.top1PartNumber) === normPart(j.line.historicalPartNumber));
      return withHistory.length ? `${hit.length}/${withHistory.length} (${(hit.length / withHistory.length * 100).toFixed(1)}%)` : "N/A";
    })(),
  };
}

function main() {
  const report = { generatedAt: new Date().toISOString(), dbPath, gate: "Fire Alarm Golden Evaluation Gate" };
  const catalog = loadCatalog(dbPath);
  if (!catalog) {
    report.status = "FAILED_CLOSED";
    report.reason = `Catalog/live snapshot not found at ${dbPath} -- a missing snapshot never counts as a pass.`;
    console.log(asJson ? JSON.stringify(report, null, 2) : report.reason);
    process.exitCode = 1;
    return;
  }

  const ckJudged = evaluateCentralKitchen(catalog.db, catalog.products).map(judgeLine);
  const operaJudged = evaluateOpera(catalog.products).map(judgeLine);
  catalog.db.close();

  const ck = summarize("Central Kitchen - Makkah", ckJudged);
  const opera = summarize("Opera Block Townhouses", operaJudged);
  report.centralKitchen = ck;
  report.operaBlock = opera;
  report.frozenBaseline = { centralKitchen: CENTRAL_KITCHEN_EXPECTED_BASELINE, operaBlock: OPERA_BLOCK_EXPECTED_BASELINE };

  // ---------------------------------------------------------------------
  // Gate conditions (see docs/fire-alarm-mvp-v1-baseline.md "release gate"
  // section for the authoritative description of each):
  //   1. a new true matching error appears
  //   2. any false resolve appears
  //   3. a previously-correct family becomes incorrect
  //   4. a correct-family candidate is displaced by an unrelated governed family
  //   5. a known genuine ambiguity becomes silently auto-resolved
  //   6. candidate discovery materially regresses without an explicitly
  //      approved baseline change (checked against the frozen 17/17 Central
      //      Kitchen baseline specifically -- Opera's catalog-coverage gaps are
  //      pre-existing/known and are not re-litigated here).
  // ---------------------------------------------------------------------
  const failures = [];
  for (const project of [ck, opera]) {
    if (project.loadErrors > 0) failures.push(`${project.label}: ${project.loadErrors} line(s) failed to load evidence (fails closed).`);
    if (project.trueMatchingErrorCount > 0) failures.push(`${project.label}: ${project.trueMatchingErrorCount} true matching error(s) on ${project.trueMatchingErrorLines.join(", ")}.`);
    if (project.falseResolveCount > 0) failures.push(`${project.label}: ${project.falseResolveCount} false resolve(s) on ${project.falseResolveLines.join(", ")}.`);
    if (project.crossFamilyRankingErrorCount > 0) failures.push(`${project.label}: ${project.crossFamilyRankingErrorCount} cross-family ranking error(s) on ${project.crossFamilyRankingErrorLines.join(", ")}.`);
  }
  const ckDiscoveredCount = ckJudged.filter((j) => j.judgment.hasCandidate).length;
  if (ckDiscoveredCount < CENTRAL_KITCHEN_GOLDEN_LINES.length) failures.push(`Central Kitchen candidate discovery regressed: ${ckDiscoveredCount}/${CENTRAL_KITCHEN_GOLDEN_LINES.length}, frozen baseline is ${CENTRAL_KITCHEN_EXPECTED_BASELINE.candidateDiscovery}.`);
  const ckFamilyWrong = ckJudged.filter((j) => !j.judgment.loadError && !j.judgment.familyMatch);
  if (ckFamilyWrong.length) failures.push(`Central Kitchen family classification regressed on: ${ckFamilyWrong.map((j) => j.line.itemRef).join(", ")}.`);

  report.gateFailures = failures;
  report.status = failures.length ? "GATE_FAILED" : "GATE_PASSED";
  report.note = "Known, pre-existing infrastructure test failures (see docs/fire-alarm-mvp-v1-baseline.md) are tracked separately by `node --test tests/*.test.mjs` and are never read or reported by this gate.";

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== ${report.gate} ===`);
    console.log(`Generated: ${report.generatedAt}`);
    console.log(`DB: ${report.dbPath}\n`);
    for (const project of [ck, opera]) {
      console.log(`-- ${project.label} --`);
      console.log(`  BOQ extraction coverage:        ${project.boqExtractionCoverage}`);
      console.log(`  Family classification accuracy: ${project.familyClassificationAccuracy}`);
      console.log(`  Candidate discovery coverage:   ${project.candidateDiscoveryCoverage}`);
      console.log(`  Acceptable candidate set rate:  ${project.acceptableCandidateSetRate}`);
      console.log(`  True matching errors:           ${project.trueMatchingErrorCount} ${project.trueMatchingErrorLines.length ? `(${project.trueMatchingErrorLines.join(", ")})` : ""}`);
      console.log(`  False resolves:                 ${project.falseResolveCount} ${project.falseResolveLines.length ? `(${project.falseResolveLines.join(", ")})` : ""}`);
      console.log(`  Cross-family ranking errors:    ${project.crossFamilyRankingErrorCount}`);
      console.log(`  Mandatory-requirement validity: ${project.mandatoryRequirementValidationCorrectness}`);
      console.log(`  Correct engineer-review rate:   ${project.correctEngineerReviewRate}`);
      console.log(`  [informational] Historical Top-1: ${project.historicalTop1InformationalRate}\n`);
    }
    console.log(report.status === "GATE_PASSED" ? "GATE PASSED -- no regression against the Fire Alarm MVP v1 frozen baseline." : `GATE FAILED:\n  - ${failures.join("\n  - ")}`);
    console.log(`\n${report.note}`);
  }
  process.exitCode = report.status === "GATE_PASSED" ? 0 : 1;
}

main();
