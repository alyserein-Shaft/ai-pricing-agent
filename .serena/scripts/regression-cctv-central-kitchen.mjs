#!/usr/bin/env node
/**
 * CCTV raw regression -- Central Kitchen - Makkah (v1).
 *
 * Purpose: measure ranking quality and Product Knowledge gaps, informational
 * only -- NOT the release gate (npm run test:cctv-golden is). Mirrors
 * scripts/regression-opera-block-fas.mjs's reporting shape (catalog
 * coverage vs matching-accuracy-given-coverage, two different denominators,
 * never conflated; Top-1/Top-3; price-evidence linkage).
 *
 * Honest v1 scope note: CCTV has exactly ONE real historical project anchor
 * today (Central Kitchen - Makkah's real, validated Hikvision quotation),
 * so this script's ground truth is the SAME 7 lines
 * tests/golden/cctv-central-kitchen.fixture.mjs already encodes -- this is
 * not yet a second, larger, independent dataset the way Opera is for Fire
 * Alarm. A future CCTV closure round should add a second real project
 * before this distinction becomes meaningful.
 *
 * Usage: node scripts/regression-cctv-central-kitchen.mjs [--db <path>]
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { projectMatchingProduct } from "../app/domain/matching-product-projection.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { buildCctvTaxonomyContext } from "../app/domain/cctv-taxonomy.mjs";
import { prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";
import { normalizeAttributeName } from "../app/domain/system-knowledge-registry.mjs";
import { CCTV_CENTRAL_KITCHEN_GOLDEN_LINES } from "../tests/golden/cctv-central-kitchen.fixture.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const DEFAULT_DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const dbPath = flag("--db", DEFAULT_DB);
const normPart = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

if (!existsSync(dbPath)) { console.error(`Catalog not found at ${dbPath}`); process.exit(1); }
const db = new DatabaseSync(dbPath, { readOnly: true });
const products = db.prepare(
  "SELECT p.id, m.name manufacturer, b.name brand, f.name family, p.part_number partNumber, p.normalized_part_number normalizedPartNumber, p.description, p.lifecycle_status lifecycleStatus, p.attributes, p.standards, p.review_status reviewStatus FROM library_products p JOIN product_manufacturers m ON m.id = p.manufacturer_id LEFT JOIN product_brands b ON b.id = p.brand_id LEFT JOIN product_families f ON f.id = p.family_id WHERE p.identity_status <> 'Superseded'",
).all().map((row) => ({ ...projectMatchingProduct(row, []), compatibility: [], accessories: [] }));

const hasPriceEvidence = (partNumber) => {
  const product = products.find((p) => normPart(p.partNumber) === normPart(partNumber));
  if (!product) return false;
  const row = db.prepare("SELECT COUNT(*) n FROM price_records WHERE product_id = ?").get(product.id);
  return Number(row?.n || 0) > 0;
};

const details = [];
for (const line of CCTV_CENTRAL_KITCHEN_GOLDEN_LINES) {
  const taxonomyContext = buildCctvTaxonomyContext({ description: line.description });
  const selected = taxonomyContext.families[0] || null;
  const system = taxonomyContext.system || "CCTV";
  const deterministic = prepareBoqUnderstandingInput({ description: line.description, boqItemId: `cctv-regression-${line.itemRef}` }).deterministicFacts;
  const attributes = selected?.family
    ? Object.fromEntries(Object.entries(deterministic)
        .map(([rawKey, fact]) => [normalizeAttributeName(system, rawKey, selected.family), fact?.value])
        .filter(([canonicalName, value]) => canonicalName && value != null))
    : {};
  const profile = {
    versionNumber: 1,
    boqItem: { id: `cctv-regression-${line.itemRef}`, description: line.description, system, category: selected?.category || null, productFamily: selected?.family || null, attributes },
    readiness: { status: "Ready with Warnings", blockingReasons: [] },
    consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
  };
  const matching = runProductMatching({ profile, products, prices: [] });
  const candidates = matching.candidates || [];
  const correctProductExistsInKb = Boolean(line.historicalPartNumber) && products.some((p) => normPart(p.partNumber) === normPart(line.historicalPartNumber));
  const top1 = candidates[0] || null;
  const top1Hit = Boolean(line.historicalPartNumber) && top1 && normPart(top1.product.partNumber) === normPart(line.historicalPartNumber);
  const top3Hit = Boolean(line.historicalPartNumber) && candidates.slice(0, 3).some((c) => normPart(c.product.partNumber) === normPart(line.historicalPartNumber));
  details.push({
    itemRef: line.itemRef,
    historicalPartNumber: line.historicalPartNumber,
    taxonomyClassifiedFamily: selected?.family || null,
    correctProductExistsInKb,
    candidateCount: candidates.length,
    top1PartNumber: top1?.product.partNumber || null,
    top1Confidence: top1?.confidence || null,
    top1Hit,
    top3Hit,
    priceEvidenceFoundForCorrectMatch: correctProductExistsInKb ? hasPriceEvidence(line.historicalPartNumber) : false,
  });
}
db.close();

const withHistory = details.filter((d) => d.historicalPartNumber);
const catalogCoverageHits = withHistory.filter((d) => d.correctProductExistsInKb).length;
const top1Hits = withHistory.filter((d) => d.top1Hit).length;
const top3Hits = withHistory.filter((d) => d.top3Hit).length;
const priceHits = withHistory.filter((d) => d.correctProductExistsInKb && d.priceEvidenceFoundForCorrectMatch).length;

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: {
    groundTruth: "Al Mespar Contracting Corp (MCC), Final Quotation Q1067-626-LCU, \"Central Kitchen - Makkah\" (Hikvision CCTV material list) -- real, issued document.",
    note: "Same 7-line dataset as tests/golden/cctv-central-kitchen.fixture.mjs -- v1 has only one real CCTV historical project anchor. A future round should add a second, independent project before catalogCoverage/Top1 here mean something distinct from the Golden Gate's own metrics.",
    catalogDb: dbPath,
  },
  cctvBaseline: {
    groundTruthRowsWithHistoricalPn: withHistory.length,
    metrics: {
      note: "These two metrics are DIFFERENT denominators and must not be conflated.",
      catalogCoverage: { formula: "correct product exists in KB / ground-truth rows with a historical PN", value: `${catalogCoverageHits}/${withHistory.length}`, percent: Number((catalogCoverageHits / withHistory.length * 100).toFixed(1)) },
      matchingAccuracyGivenCoverage: {
        formula: "correct match (Top-1) / rows where correct product exists in KB",
        top1: `${top1Hits}/${catalogCoverageHits}`, top1Percent: Number((top1Hits / catalogCoverageHits * 100).toFixed(1)),
        top3: `${top3Hits}/${catalogCoverageHits}`, top3Percent: Number((top3Hits / catalogCoverageHits * 100).toFixed(1)),
      },
      priceLinkageAmongCorrectMatches: { value: `${priceHits}/${catalogCoverageHits}`, percent: Number((priceHits / catalogCoverageHits * 100).toFixed(1)) },
    },
    details,
  },
}, null, 2));
