#!/usr/bin/env node
/**
 * CCTV Golden Evaluation Gate -- CCTV System Pack v1 release gate.
 *
 * Runs the CURRENT, UNMODIFIED product-matching engine
 * (app/domain/product-matching-engine.mjs) against the one real, frozen
 * Golden project this v1 scope is built from (Central Kitchen - Makkah's
 * real, validated Hikvision CCTV quotation --
 * tests/golden/cctv-central-kitchen.fixture.mjs) and fails (non-zero exit)
 * if matching quality regresses against that frozen baseline.
 *
 * This mirrors scripts/fire-alarm-golden-evaluation-gate.mjs's own
 * evaluateOpera() pattern exactly (a minimal profile built directly from the
 * BOQ line's own text via the CCTV taxonomy's classifier, no live
 * project/approval state required) -- CCTV has only one real Golden project
 * at v1, so there is no Central-Kitchen-style live-requirement-profile
 * evaluation path yet.
 *
 * This is NOT the same thing as `node --test tests/*.test.mjs`. Pre-existing,
 * unrelated test failures are tracked separately and never read here.
 *
 * Usage:
 *   node scripts/cctv-golden-evaluation-gate.mjs [--db <path-to-d1-sqlite>] [--json]
 *
 * Exit code 0 = gate passed. Exit code 1 = gate failed, or the catalog
 * snapshot could not be loaded at all (fails closed).
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { projectMatchingProduct } from "../app/domain/matching-product-projection.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { buildCctvTaxonomyContext } from "../app/domain/cctv-taxonomy.mjs";
import { prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";
import { normalizeAttributeName } from "../app/domain/system-knowledge-registry.mjs";
import { CCTV_CENTRAL_KITCHEN_GOLDEN_LINES, CCTV_CENTRAL_KITCHEN_EXPECTED_BASELINE } from "../tests/golden/cctv-central-kitchen.fixture.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const asJson = args.includes("--json");
const DEFAULT_DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const dbPath = flag("--db", DEFAULT_DB);
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normPart = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function loadCatalog(path) {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const products = db.prepare(
      "SELECT p.id, m.name manufacturer, b.name brand, f.name family, p.part_number partNumber, p.normalized_part_number normalizedPartNumber, p.description, p.lifecycle_status lifecycleStatus, p.attributes, p.standards, p.review_status reviewStatus FROM library_products p JOIN product_manufacturers m ON m.id = p.manufacturer_id LEFT JOIN product_brands b ON b.id = p.brand_id LEFT JOIN product_families f ON f.id = p.family_id WHERE p.identity_status <> 'Superseded'",
    ).all().map((row) => ({ ...projectMatchingProduct(row, []), compatibility: [], accessories: [] }));
    return { db, products };
  } catch (error) {
    db.close();
    throw error;
  }
}

function evaluate(products) {
  const results = [];
  for (const line of CCTV_CENTRAL_KITCHEN_GOLDEN_LINES) {
    const taxonomyContext = buildCctvTaxonomyContext({ description: line.description });
    const selected = taxonomyContext.families[0] || null;
    const system = taxonomyContext.system || "CCTV";
    // Reuse the EXACT production deterministic-fact extractor
    // (prepareBoqUnderstandingInput) and the same governed name-
    // normalization the real merge path uses (normalizeAttributeName),
    // never a second, parallel implementation -- mirrors production
    // behavior, not a test-only mapping.
    const deterministic = prepareBoqUnderstandingInput({ description: line.description, boqItemId: `cctv-golden-${line.itemRef}` }).deterministicFacts;
    const attributes = selected?.family
      ? Object.fromEntries(Object.entries(deterministic)
          .map(([rawKey, fact]) => [normalizeAttributeName(system, rawKey, selected.family), fact?.value])
          .filter(([canonicalName, value]) => canonicalName && value != null))
      : {};
    const profile = {
      versionNumber: 1,
      boqItem: { id: `cctv-golden-${line.itemRef}`, description: line.description, system, category: selected?.category || null, productFamily: selected?.family || null, attributes },
      readiness: { status: "Ready with Warnings", blockingReasons: [] },
      consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
    };
    const matching = runProductMatching({ profile, products, prices: [] });
    results.push({ line, profile, matching });
  }
  return results;
}

function judgeLine(entry) {
  const { line, matching } = entry;
  const candidates = matching.candidates || [];
  const acceptableSet = new Set((line.acceptablePartNumbers || []).map(normPart));
  const isAcceptable = (candidate) => acceptableSet.size
    ? acceptableSet.has(normPart(candidate.product.partNumber))
    : (line.expectedFamily && norm(candidate.product.family) === norm(line.expectedFamily) && !candidate.mandatoryFailures.length);

  const familyMatch = line.expectedFamily == null || norm(entry.profile.boqItem.productFamily) === norm(line.expectedFamily);
  const firstAcceptableIndex = candidates.findIndex(isAcceptable);
  const aboveFirstAcceptable = firstAcceptableIndex === -1 ? candidates : candidates.slice(0, firstAcceptableIndex);
  const trueMatchingError = firstAcceptableIndex > 0 && aboveFirstAcceptable.some((c) => (c.familyMatchTier ?? 0) > (candidates[firstAcceptableIndex]?.familyMatchTier ?? 0));
  const crossFamilyRankingError = firstAcceptableIndex > 0 && aboveFirstAcceptable.some((c) => (c.familyMatchTier ?? 0) === 2);
  const hasCandidate = candidates.length > 0;
  const top1 = candidates[0] || null;
  const top1Acceptable = top1 ? isAcceptable(top1) : false;
  const top1MandatoryClean = top1 ? !top1.mandatoryFailures.length : false;
  const secondCandidate = candidates[1] || null;
  const looksSingularlyResolved = top1MandatoryClean && (!secondCandidate || secondCandidate.score < top1.score || (secondCandidate.familyMatchTier ?? 0) > (top1.familyMatchTier ?? 0));
  const falseResolve = line.expectedFinalState !== "RESOLVED" && top1Acceptable && looksSingularlyResolved;
  const correctEngineerReview = line.expectedFinalState === "RESOLVED" ? null : !falseResolve;

  return {
    ...entry,
    judgment: {
      familyMatch, computedFamily: entry.profile.boqItem.productFamily,
      hasCandidate, top1PartNumber: top1?.product.partNumber || null, top1Acceptable, top1MandatoryClean,
      trueMatchingError, crossFamilyRankingError, falseResolve, correctEngineerReview,
    },
  };
}

function summarize(label, judged) {
  const n = judged.length;
  const familyCorrect = judged.filter((j) => j.judgment.familyMatch).length;
  const discovered = judged.filter((j) => j.judgment.hasCandidate).length;
  const acceptable = judged.filter((j) => !j.judgment.trueMatchingError).length;
  const trueErrors = judged.filter((j) => j.judgment.trueMatchingError);
  const crossFamilyErrors = judged.filter((j) => j.judgment.crossFamilyRankingError);
  const falseResolves = judged.filter((j) => j.judgment.falseResolve);
  const reviewLines = judged.filter((j) => j.judgment.correctEngineerReview !== null);
  const correctReview = reviewLines.filter((j) => j.judgment.correctEngineerReview).length;
  return {
    label, lines: n,
    familyClassificationAccuracy: `${familyCorrect}/${n} (${(familyCorrect / n * 100).toFixed(1)}%)`,
    candidateDiscoveryCoverage: `${discovered}/${n} (${(discovered / n * 100).toFixed(1)}%)`,
    acceptableCandidateSetRate: `${acceptable}/${n} (${(acceptable / n * 100).toFixed(1)}%)`,
    trueMatchingErrorCount: trueErrors.length,
    trueMatchingErrorLines: trueErrors.map((j) => j.line.itemRef),
    falseResolveCount: falseResolves.length,
    falseResolveLines: falseResolves.map((j) => j.line.itemRef),
    crossFamilyRankingErrorCount: crossFamilyErrors.length,
    crossFamilyRankingErrorLines: crossFamilyErrors.map((j) => j.line.itemRef),
    correctEngineerReviewRate: reviewLines.length ? `${correctReview}/${reviewLines.length} (${(correctReview / reviewLines.length * 100).toFixed(1)}%)` : "N/A",
    historicalTop1InformationalRate: (() => {
      const withHistory = judged.filter((j) => j.line.historicalPNIsGroundTruth && j.line.historicalPartNumber);
      const hit = withHistory.filter((j) => normPart(j.judgment.top1PartNumber) === normPart(j.line.historicalPartNumber));
      return withHistory.length ? `${hit.length}/${withHistory.length} (${(hit.length / withHistory.length * 100).toFixed(1)}%)` : "N/A";
    })(),
  };
}

function main() {
  const report = { generatedAt: new Date().toISOString(), dbPath, gate: "CCTV Golden Evaluation Gate" };
  const catalog = loadCatalog(dbPath);
  if (!catalog) {
    report.status = "FAILED_CLOSED";
    report.reason = `Catalog/live snapshot not found at ${dbPath} -- a missing snapshot never counts as a pass.`;
    console.log(asJson ? JSON.stringify(report, null, 2) : report.reason);
    process.exitCode = 1;
    return;
  }

  const judged = evaluate(catalog.products).map(judgeLine);
  catalog.db.close();

  const ck = summarize("Central Kitchen - Makkah (CCTV)", judged);
  report.centralKitchenCctv = ck;
  report.frozenBaseline = CCTV_CENTRAL_KITCHEN_EXPECTED_BASELINE;

  const failures = [];
  if (ck.trueMatchingErrorCount > 0) failures.push(`${ck.label}: ${ck.trueMatchingErrorCount} true matching error(s) on ${ck.trueMatchingErrorLines.join(", ")}.`);
  if (ck.falseResolveCount > 0) failures.push(`${ck.label}: ${ck.falseResolveCount} false resolve(s) on ${ck.falseResolveLines.join(", ")}.`);
  if (ck.crossFamilyRankingErrorCount > 0) failures.push(`${ck.label}: ${ck.crossFamilyRankingErrorCount} cross-family ranking error(s) on ${ck.crossFamilyRankingErrorLines.join(", ")}.`);
  const discoveredCount = judged.filter((j) => j.judgment.hasCandidate).length;
  const [expectedDiscovered] = CCTV_CENTRAL_KITCHEN_EXPECTED_BASELINE.candidateDiscovery.split("/").map(Number);
  if (discoveredCount < expectedDiscovered) failures.push(`Candidate discovery regressed: ${discoveredCount}/${judged.length}, frozen baseline is ${CCTV_CENTRAL_KITCHEN_EXPECTED_BASELINE.candidateDiscovery}.`);
  const familyWrong = judged.filter((j) => !j.judgment.familyMatch);
  if (familyWrong.length) failures.push(`Family classification regressed on: ${familyWrong.map((j) => j.line.itemRef).join(", ")}.`);

  report.gateFailures = failures;
  report.status = failures.length ? "GATE_FAILED" : "GATE_PASSED";
  report.note = "CCTV System Pack v1 -- see docs/cctv-system-pack-v1-release.md for scope and known limitations.";

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== ${report.gate} ===`);
    console.log(`Generated: ${report.generatedAt}`);
    console.log(`DB: ${report.dbPath}\n`);
    console.log(`-- ${ck.label} --`);
    console.log(`  Family classification accuracy: ${ck.familyClassificationAccuracy}`);
    console.log(`  Candidate discovery coverage:   ${ck.candidateDiscoveryCoverage}`);
    console.log(`  Acceptable candidate set rate:  ${ck.acceptableCandidateSetRate}`);
    console.log(`  True matching errors:           ${ck.trueMatchingErrorCount} ${ck.trueMatchingErrorLines.length ? `(${ck.trueMatchingErrorLines.join(", ")})` : ""}`);
    console.log(`  False resolves:                 ${ck.falseResolveCount} ${ck.falseResolveLines.length ? `(${ck.falseResolveLines.join(", ")})` : ""}`);
    console.log(`  Cross-family ranking errors:    ${ck.crossFamilyRankingErrorCount}`);
    console.log(`  Correct engineer-review rate:   ${ck.correctEngineerReviewRate}`);
    console.log(`  [informational] Historical Top-1: ${ck.historicalTop1InformationalRate}\n`);
    console.log(report.status === "GATE_PASSED" ? "GATE PASSED -- no regression against the CCTV System Pack v1 frozen baseline." : `GATE FAILED:\n  - ${failures.join("\n  - ")}`);
    console.log(`\n${report.note}`);
  }
  process.exitCode = report.status === "GATE_PASSED" ? 0 : 1;
}

main();
