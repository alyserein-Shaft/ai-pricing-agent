#!/usr/bin/env node
/**
 * Central Kitchen regression harness (Sprint 0 baseline).
 *
 * Runs the real BOQ extraction engine against the real Central Kitchen BOQ
 * (inputs/central-kitchen/source-boq.xlsx) and the real product-matching
 * engine against the live local product catalog, then compares matching
 * output to the human-verified CCTV comparison workbook's "Relationships"
 * sheet (outputs/central-kitchen-approved/Central_Kitchen_CCTV_Comparison_v8.xlsx),
 * which is the only ground truth in this dataset with a row-level BOQ item
 * -> final part number mapping.
 *
 * The local product catalog is read from a gitignored, machine-local
 * Wrangler/D1 SQLite snapshot. This script is not CI-portable as-is; pass
 * --db to point at a different snapshot, or it will report catalog: null
 * and skip the product-matching section.
 *
 * Usage: node scripts/regression-central-kitchen.mjs [--db <path-to-d1-sqlite>]
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseXlsxWorkbook } from "../app/document-parsers/xlsx.mjs";
import { extractBoqBytes } from "../app/domain/boq-extractor.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const DEFAULT_DB = "faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const dbPath = flag("--db", DEFAULT_DB);

const BOQ_PATH = "inputs/central-kitchen/source-boq.xlsx";
const CCTV_GROUND_TRUTH_PATH = "outputs/central-kitchen-approved/Central_Kitchen_CCTV_Comparison_v8.xlsx";

const norm = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function loadBoqExtraction() {
  const bytes = await readFile(BOQ_PATH);
  return extractBoqBytes(new Uint8Array(bytes), { extension: "xlsx", fileName: "source-boq.xlsx" });
}

function sheetRows(sheet) {
  return sheet.rows.map((row) => {
    const values = Array.from({ length: sheet.maxColumn }, () => "");
    for (const cell of row.cells) values[cell.column - 1] = cell.value;
    return values;
  });
}

async function loadCctvGroundTruth() {
  const bytes = await readFile(CCTV_GROUND_TRUTH_PATH);
  const workbook = parseXlsxWorkbook(new Uint8Array(bytes), { fileName: "cctv-comparison.xlsx" });
  const sheet = workbook.sheets.find((s) => s.name === "Relationships");
  if (!sheet) throw new Error(`"Relationships" sheet not found in ${CCTV_GROUND_TRUTH_PATH}`);
  const rows = sheetRows(sheet);
  const header = rows[0];
  const columnIndex = (name) => header.indexOf(name);
  const cols = {
    sourceItem: columnIndex("source_item"),
    sourceDescription: columnIndex("source_description"),
    finalPartNumbers: columnIndex("final_part_numbers"),
  };
  return rows.slice(1)
    .filter((values) => values[cols.sourceDescription])
    .map((values) => ({
      sourceItem: values[cols.sourceItem],
      sourceDescription: values[cols.sourceDescription],
      finalPartNumbers: String(values[cols.finalPartNumbers] || "")
        .split("\n").map((entry) => entry.trim()).filter(Boolean),
    }));
}

function loadCatalog(path) {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  let products, priceByProduct;
  try {
    products = db.prepare(`
      SELECT p.id, m.name manufacturer, b.name brand, f.name family, p.part_number partNumber,
             p.normalized_part_number normalizedPartNumber, p.description, p.lifecycle_status lifecycleStatus,
             p.attributes, p.standards, p.review_status reviewStatus
      FROM library_products p
      JOIN product_manufacturers m ON m.id = p.manufacturer_id
      LEFT JOIN product_brands b ON b.id = p.brand_id
      LEFT JOIN product_families f ON f.id = p.family_id
      WHERE p.identity_status <> 'Superseded'
    `).all().map((row) => ({
      ...row,
      attributes: JSON.parse(row.attributes || "[]"),
      standards: JSON.parse(row.standards || "[]"),
      compatibility: [],
      accessories: [],
    }));
    const priceRows = db.prepare(`
      SELECT product_id, approval_status, validity_state
      FROM price_records
      WHERE approval_status = 'Approved' AND validity_state = 'Current'
    `).all();
    priceByProduct = new Set(priceRows.map((row) => row.product_id));
  } finally {
    db.close();
  }
  return { products, priceByProduct, distinctManufacturers: new Set(products.map((p) => p.manufacturer)).size };
}

function matchBoqRowForDescription(extractedItems, description) {
  const target = norm(description);
  const targetTokens = new Set(target.split(" ").filter(Boolean));
  let best = null, bestScore = 0;
  for (const item of extractedItems) {
    const candidate = norm(item.description);
    if (!candidate) continue;
    if (candidate === target) return { item, score: 1 };
    const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
    const overlap = [...targetTokens].filter((token) => candidateTokens.has(token)).length;
    const score = overlap / Math.max(targetTokens.size, candidateTokens.size, 1);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 0.6 ? { item: best, score: bestScore } : null;
}

function buildProfile(boqRow, groundTruth) {
  return {
    versionNumber: 1,
    boqItem: {
      id: groundTruth.sourceItem,
      description: boqRow?.description || groundTruth.sourceDescription,
      system: "CCTV",
      category: null,
      productFamily: null,
    },
    // No taxonomy/attribute profile exists for CCTV in this repo today, so a
    // full technical-requirement-engine profile cannot be produced honestly.
    // "Ready with Warnings" is the closest accurate readiness claim: basic
    // classification exists, no mandatory attribute baseline does.
    readiness: { status: "Ready with Warnings", blockingReasons: [] },
    consolidatedRequirements: [],
    standards: [],
    manufacturers: [],
    compatibility: [],
    accessories: [],
    derivedRequirements: [],
    clarifications: [],
  };
}

async function main() {
  const extraction = await loadBoqExtraction();
  const validItems = extraction.rows.filter((row) => row.rowType === "BOQ Item");
  const groundTruth = await loadCctvGroundTruth();
  const catalog = loadCatalog(dbPath);

  const report = {
    generatedAt: new Date().toISOString(),
    sources: { boq: BOQ_PATH, cctvGroundTruth: CCTV_GROUND_TRUTH_PATH, catalogDb: dbPath, catalogAvailable: Boolean(catalog) },
    extraction: {
      totalRowsDetected: extraction.summary.totalRowsDetected,
      validBoqItems: extraction.summary.validBoqItems,
      itemsNeedingReview: extraction.summary.itemsNeedingReview,
      missingQuantities: extraction.summary.missingQuantities,
      missingUnits: extraction.summary.missingUnits,
      possibleDuplicates: extraction.summary.possibleDuplicates,
      averageConfidence: extraction.summary.averageConfidence,
    },
    catalog: catalog ? { totalProducts: catalog.products.length, distinctManufacturers: catalog.distinctManufacturers } : null,
  };

  if (!catalog) {
    report.cctvProductMatch = { status: "N/A", reason: `Catalog snapshot not found at ${dbPath}` };
  } else {
    let boqRowsMapped = 0, itemsWithCandidate = 0, top1 = 0, top3 = 0, priceLinkedTop1 = 0;
    const details = [];
    for (const gt of groundTruth) {
      const mapping = matchBoqRowForDescription(validItems, gt.sourceDescription);
      if (mapping) boqRowsMapped += 1;
      const profile = buildProfile(mapping?.item, gt);
      const result = runProductMatching({ profile, products: catalog.products, prices: [] });
      const candidates = result.candidates || [];
      if (candidates.length) itemsWithCandidate += 1;
      const groundTruthNorm = gt.finalPartNumbers.map(norm);
      const top1Product = candidates[0]?.product;
      const top1Hit = top1Product ? groundTruthNorm.includes(norm(top1Product.partNumber)) : false;
      const top3Hit = candidates.slice(0, 3).some((c) => groundTruthNorm.includes(norm(c.product.partNumber)));
      if (top1Hit) top1 += 1;
      if (top3Hit) top3 += 1;
      const top1HasCurrentPrice = top1Product ? catalog.priceByProduct.has(top1Product.id) : false;
      if (top1Hit && top1HasCurrentPrice) priceLinkedTop1 += 1;
      details.push({
        sourceItem: gt.sourceItem,
        boqRowMapped: Boolean(mapping),
        boqRowMappingScore: mapping ? Number(mapping.score.toFixed(2)) : null,
        candidateCount: candidates.length,
        top1PartNumber: top1Product?.partNumber || null,
        top1Manufacturer: top1Product?.manufacturer || null,
        top1Stage: candidates[0]?.searchStage || null,
        top1ConfidenceScore: candidates[0]?.confidenceScore ?? null,
        top1Confidence: candidates[0]?.confidence || null,
        groundTruthPartNumbers: gt.finalPartNumbers,
        top1Hit,
        top3Hit,
        top1HasCurrentPriceEvidence: top1HasCurrentPrice,
      });
    }
    const n = groundTruth.length;
    report.cctvProductMatch = {
      groundTruthItems: n,
      boqRowsMapped,
      boqRowsMappedRate: n ? Number((boqRowsMapped / n * 100).toFixed(1)) : null,
      itemsWithAnyCandidate: itemsWithCandidate,
      top1Matches: top1,
      top1Rate: n ? Number((top1 / n * 100).toFixed(1)) : null,
      top3Matches: top3,
      top3Rate: n ? Number((top3 / n * 100).toFixed(1)) : null,
      priceLinkage: {
        note: "Measured only for items where the Top-1 match was correct (top1Hit=true); N/A entries below have no correct candidate to check a price against.",
        top1CorrectAndPriceLinked: priceLinkedTop1,
        top1CorrectCount: top1,
        rateAmongTop1Correct: top1 ? Number((priceLinkedTop1 / top1 * 100).toFixed(1)) : "N/A (no Top-1 correct matches to measure against)",
      },
      details,
    };
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
