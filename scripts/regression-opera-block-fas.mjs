#!/usr/bin/env node
/**
 * Opera Block Townhouses (Diriyah) - Fire Alarm golden baseline (Sprint 0.1).
 *
 * Ground truth: the 26 material line items (S/N 1-26; S/N 27 "Fire Alarm
 * System Testing & Commissioning" is a service line, excluded) from the real,
 * issued final quotation "Addressable Fire Alarm System - Farenhyt By
 * Honeywell" (Al Mespar Contracting Corp, Q1039-426-LCU, Rev00, 22-Apr-26,
 * total SAR 695,984.00 -- matching outputs/project-pricing-learning-validation/
 * OPERA_BLOCK_TOWNHOUSES_VALIDATION_REPORT.md's independently-recorded figure).
 *
 * Source: the final quotation's original .xlsx was not found on disk; only
 * its PDF export exists (Downloads/Projects/Opera Block Townhouses-Diriyah/
 * Quotation/Q1039-426-LCU-Opera Block Townhouses-Diriyah.pdf). That PDF uses
 * embedded CID-encoded fonts this repo's (and this script's) literal-text
 * extraction cannot decode, so the table below was read directly from
 * pre-rendered page images already present in this repo at
 * tmp/opera/render/final-03.jpg and final-04.jpg (produced by an earlier
 * session) and transcribed verbatim, including quantities and prices, as a
 * cross-check against transcription error. This is real project data, not a
 * fabricated fixture -- see the cited source images and validation report.
 *
 * This is a genuinely different, harder-to-fake ground truth than a BOQ:
 * it is what the client was actually charged for, matched to real
 * manufacturer part numbers, by a human engineer, not a synthetic case.
 *
 * Reports two distinct metrics per the Sprint 0.1 requirement -- these are
 * NOT the same number and must not be conflated:
 *   Catalog Coverage            = correct product exists in KB / ground-truth rows
 *   Matching Accuracy Given Coverage = correct match / rows where correct product exists in KB
 *
 * Usage: node scripts/regression-opera-block-fas.mjs [--db <path-to-d1-sqlite>]
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { buildFireAlarmTaxonomyContext } from "../app/domain/fire-alarm-taxonomy.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const DEFAULT_DB = "faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const dbPath = flag("--db", DEFAULT_DB);

const norm = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normPart = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Transcribed verbatim from tmp/opera/render/final-03.jpg (S/N 1-21) and
// final-04.jpg (S/N 22-26; S/N 27 "Serv-01" testing/commissioning line
// excluded -- it is a labor line, not a product).
const GROUND_TRUTH = [
  { sn: 1, partNumber: "IFP-2100ECSHV", description: "Farenhyt 2100 point Integrated Fire Alarm & Emergency Communication System, 4 line LCD display with 40 characters per line, One SLC loop card inbuild, 159 Detectors and 159 Modules per loop, Additional Loop cards can be expanded through 5815RMK, Network upto 32 panels, inbuild eight on-board Flexput circuits, Built in USB interface for programming, Support for up to 16 addressable amplifiers, Four programmable function keys, 240VAC @ 50/60Hz, 2.8A, UL Listing and FM Approved, Red Cabinet", qty: 6, unitPrice: 16505.00 },
  { sn: 2, partNumber: "BB-26", description: "BATTERY BACKBOX-MOUNTS UP TO 2, BAT-12260 BATTERIES", qty: 6, unitPrice: 1001.00 },
  { sn: 3, partNumber: "Battery", description: "12V, 26AH Battery", qty: 12, unitPrice: 368.00 },
  { sn: 4, partNumber: "RPS-1000HV", description: "High voltage (240V) Intelligent Distributed Power Module", qty: 1, unitPrice: 3755.00 },
  { sn: 5, partNumber: "Batt", description: "12V, 7AH Battery", qty: 2, unitPrice: 84.00 },
  { sn: 6, partNumber: "ECS-50WHV", description: "ECS 50 Watt Amplifier 220vac 50/60Hz", qty: 6, unitPrice: 7150.00 },
  { sn: 7, partNumber: "5815RMK", description: "Remote Mounting Kit Cabinet holds two 6815s. Red Cabinet", qty: 5, unitPrice: 1685.00 },
  { sn: 8, partNumber: "6815", description: "SLC Loop Expander which supports 159 Detectors and 159 Modules", qty: 10, unitPrice: 1115.00 },
  { sn: 9, partNumber: "IDP-PHOTO-IV", description: "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)", qty: 516, unitPrice: 107.00 },
  { sn: 10, partNumber: "B501-IV", description: "4\" standard flangeless mounting base (Ivory Color)", qty: 516, unitPrice: 21.00 },
  { sn: 11, partNumber: "IDP-PHOTO-IV", description: "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)", qty: 1221, unitPrice: 107.00 },
  { sn: 12, partNumber: "B200S-IV", description: "Ivory Color, Intelligent addressable sounder base capable of producing sound output in high or low volume with ANSI Temporal 3, ANSI Temporal 4, continuous tone, marching tone, and custom tone.", qty: 1221, unitPrice: 146.00 },
  { sn: 13, partNumber: "IDP-FIRE-CO-IV", description: "Advanced multi-criteria fire/CO detector, Ivory color. (Base Not Included)", qty: 93, unitPrice: 598.00 },
  { sn: 14, partNumber: "B501-IV", description: "4\" standard flangeless mounting base (Ivory Color)", qty: 93, unitPrice: 21.00 },
  { sn: 15, partNumber: "IDP-HEAT-ROR-IV", description: "Intelligent Addressable Fixed temperature and rate-of-rise thermal detector (Rate-of-rise detection 15F/min (9C/min)) (Base Not Included) (Ivory Color)", qty: 149, unitPrice: 105.00 },
  { sn: 16, partNumber: "B501-IV", description: "4\" standard flangeless mounting base (Ivory Color)", qty: 149, unitPrice: 21.00 },
  { sn: 17, partNumber: "IDP-PULL-DA", description: "Intelligent Addressable Pull Station, Dual Action, Key Reset", qty: 17, unitPrice: 205.00 },
  { sn: 18, partNumber: "STI3150", description: "Weather Stopper II, surface mount.", qty: 1, unitPrice: 558.00 },
  { sn: 19, partNumber: "P2RL", description: "HORN STROBE 2W RED WALL", qty: 7, unitPrice: 298.00 },
  { sn: 20, partNumber: "SPSCRL", description: "SPEAKER STROBE RED CEILING", qty: 15, unitPrice: 308.00 },
  { sn: 21, partNumber: "SPSRL", description: "SPEAKER STROBE RED WALL", qty: 9, unitPrice: 280.00 },
  { sn: 22, partNumber: "IDP-RELAY", description: "Intelligent Addressable Relay Module W/ 2 Isolated Sets Of Form C Contacts", qty: 6, unitPrice: 124.00 },
  { sn: 23, partNumber: "SMB500", description: "4\" Square Surface Mount Electrical Box for use with IDP modules", qty: 6, unitPrice: 48.00 },
  { sn: 24, partNumber: "IFP-FFT", description: "Farenhyt Fire Fighter Telephone Control Panel", qty: 1, unitPrice: 8500.00 },
  { sn: 25, partNumber: "FFT-RHS", description: "Remote Handset", qty: 1, unitPrice: 1112.00 },
  { sn: 26, partNumber: "FFT-FPJ", description: "Fire Fighter Phone Jack", qty: 6, unitPrice: 474.00 },
];

// Integrity check against the independently-recorded total in
// outputs/project-pricing-learning-validation/OPERA_BLOCK_TOWNHOUSES_VALIDATION_REPORT.md
// (SAR 695,984.00) plus the Serv-01 testing/commissioning line (42,075.00).
const transcribedMaterialTotal = GROUND_TRUTH.reduce((sum, row) => sum + row.qty * row.unitPrice, 0);
const EXPECTED_TOTAL_WITH_SERVICE = 695984.00;
const SERVICE_LINE = 42075.00;

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
    const priceRows = db.prepare(`SELECT DISTINCT product_id FROM price_records`).all();
    priceByProduct = new Set(priceRows.map((row) => row.product_id));
  } finally {
    db.close();
  }
  return { products, priceByProduct };
}

function buildProfile(description) {
  // Use the same deterministic, non-AI governed taxonomy classifier the real
  // pipeline uses (app/domain/fire-alarm-taxonomy.mjs) to classify system/
  // category/productFamily from the description before matching, instead of
  // leaving them null. This mirrors production behavior (BOQ understanding
  // classifies family before matching runs) rather than testing description-
  // only Semantic Discovery in isolation, which would understate real
  // matching quality.
  const taxonomyContext = buildFireAlarmTaxonomyContext({ description });
  const selected = taxonomyContext.families[0] || null;
  return {
    versionNumber: 1,
    boqItem: {
      id: "opera-fas-item",
      description,
      system: taxonomyContext.system || "Fire Alarm",
      category: selected?.category || null,
      productFamily: selected?.family || null,
    },
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

function main() {
  const catalog = loadCatalog(dbPath);
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      groundTruth: "tmp/opera/render/final-03.jpg, final-04.jpg (Al Mespar Contracting Corp final quotation Q1039-426-LCU, Rev00, real issued document)",
      crossCheck: "outputs/project-pricing-learning-validation/OPERA_BLOCK_TOWNHOUSES_VALIDATION_REPORT.md",
      catalogDb: dbPath,
      catalogAvailable: Boolean(catalog),
    },
    integrityCheck: {
      transcribedMaterialLinesTotal: Number(transcribedMaterialTotal.toFixed(2)),
      plusServiceLine: SERVICE_LINE,
      transcribedGrandTotal: Number((transcribedMaterialTotal + SERVICE_LINE).toFixed(2)),
      expectedGrandTotal: EXPECTED_TOTAL_WITH_SERVICE,
      matches: Math.abs((transcribedMaterialTotal + SERVICE_LINE) - EXPECTED_TOTAL_WITH_SERVICE) < 0.01,
    },
  };

  if (!catalog) {
    report.fasBaseline = { status: "N/A", reason: `Catalog snapshot not found at ${dbPath}` };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  let correctProductExistsInKb = 0, candidateProduced = 0, top1Correct = 0, top3Correct = 0, noCandidate = 0, incorrectCandidate = 0, priceEvidenceFoundForCorrect = 0;
  const details = [];

  for (const row of GROUND_TRUTH) {
    const groundTruthKey = normPart(row.partNumber);
    const existsInKb = catalog.products.some((p) => normPart(p.partNumber) === groundTruthKey || normPart(p.normalizedPartNumber) === groundTruthKey);
    if (existsInKb) correctProductExistsInKb += 1;

    const profile = buildProfile(row.description);
    const taxonomyFamily = profile.boqItem.productFamily;
    const result = runProductMatching({ profile, products: catalog.products, prices: [] });
    const candidates = result.candidates || [];
    if (candidates.length) candidateProduced += 1; else noCandidate += 1;

    const top1 = candidates[0]?.product;
    const top1Hit = top1 ? normPart(top1.partNumber) === groundTruthKey : false;
    const top3Hit = candidates.slice(0, 3).some((c) => normPart(c.product.partNumber) === groundTruthKey);
    if (top1Hit) top1Correct += 1;
    if (top3Hit) top3Correct += 1;
    if (existsInKb && candidates.length && !top1Hit) incorrectCandidate += 1;

    const priceLinked = top1Hit && top1 ? catalog.priceByProduct.has(top1.id) : false;
    if (top1Hit && priceLinked) priceEvidenceFoundForCorrect += 1;

    details.push({
      sn: row.sn,
      groundTruthPartNumber: row.partNumber,
      taxonomyClassifiedFamily: taxonomyFamily,
      correctProductExistsInKb: existsInKb,
      candidateCount: candidates.length,
      top1PartNumber: top1?.partNumber || null,
      top1Stage: candidates[0]?.searchStage || null,
      top1ConfidenceScore: candidates[0]?.confidenceScore ?? null,
      top1Confidence: candidates[0]?.confidence || null,
      top1Hit,
      top3Hit,
      priceEvidenceFoundForCorrectMatch: priceLinked,
    });
  }

  const n = GROUND_TRUTH.length;
  report.fasBaseline = {
    groundTruthRows: n,
    correctProductExistsInKb,
    candidateProduced,
    noCandidate,
    incorrectCandidate,
    top1Correct,
    top3Correct,
    priceEvidenceFoundForCorrectMatch: priceEvidenceFoundForCorrect,
    metrics: {
      note: "These two metrics are DIFFERENT denominators and must not be conflated.",
      catalogCoverage: {
        formula: "correct product exists in KB / ground-truth rows",
        value: `${correctProductExistsInKb}/${n}`,
        percent: Number((correctProductExistsInKb / n * 100).toFixed(1)),
      },
      matchingAccuracyGivenCoverage: correctProductExistsInKb
        ? {
            formula: "correct match (Top-1) / rows where correct product exists in KB",
            top1: `${top1Correct}/${correctProductExistsInKb}`,
            top1Percent: Number((top1Correct / correctProductExistsInKb * 100).toFixed(1)),
            top3: `${top3Correct}/${correctProductExistsInKb}`,
            top3Percent: Number((top3Correct / correctProductExistsInKb * 100).toFixed(1)),
          }
        : { formula: "correct match / rows where correct product exists in KB", value: "N/A (0 rows have the correct product in KB)" },
      priceLinkageAmongCorrectMatches: top1Correct
        ? { value: `${priceEvidenceFoundForCorrect}/${top1Correct}`, percent: Number((priceEvidenceFoundForCorrect / top1Correct * 100).toFixed(1)) }
        : { value: "N/A (0 Top-1-correct matches to check price against)" },
    },
    details,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
