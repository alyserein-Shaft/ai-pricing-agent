#!/usr/bin/env node
// Stage 4Z — Run benchmark via the existing localhost API endpoint.
// Batched to respect the 12-number limit per request.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TMP = join(ROOT, "tmp");
const API = "http://localhost:4183/api/dev/benchmark/requirement-models";
const BATCH_SIZE = 10;

const args = process.argv.slice(2);
const modelKey = args[0];
const mode = args[1] || "--run";

if (!modelKey || !["A", "B", "C"].includes(modelKey)) {
  console.error("Usage: node scripts/run-benchmark-via-api.mjs <A|B|C> [--run|--resume]");
  process.exit(1);
}

const datasetPath = join(TMP, "benchmark-dataset.json");
if (!existsSync(datasetPath)) {
  console.error("Run --dataset first (node scripts/run-requirement-benchmark.mjs --dataset)");
  process.exit(1);
}

const dataset = JSON.parse(readFileSync(datasetPath, "utf-8"));
const allNumbers = dataset.map((d) => d.number);
const resultsPath = join(TMP, `benchmark-results-${modelKey}.json`);

// Load existing results for resume
let results = [];
if (existsSync(resultsPath) && mode === "--resume") {
  results = JSON.parse(readFileSync(resultsPath, "utf-8"));
}
const doneNumbers = new Set(results.map((r) => r.number));
const pendingNumbers = allNumbers.filter((n) => !doneNumbers.has(n));

console.log(`Model: ${modelKey}`);
console.log(`Total dataset: ${allNumbers.length}`);
console.log(`Already done: ${doneNumbers.size}`);
console.log(`Pending: ${pendingNumbers.length}`);

if (pendingNumbers.length === 0) {
  console.log("Nothing to run. Use --run to re-run all.");
  process.exit(0);
}

// Batch the pending numbers
const batches = [];
for (let i = 0; i < pendingNumbers.length; i += BATCH_SIZE) {
  batches.push(pendingNumbers.slice(i, i + BATCH_SIZE));
}

console.log(`Batches: ${batches.length} (${BATCH_SIZE} per batch)`);

async function runBatch(numbers) {
  const resp = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelKey, numbers }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function main() {
  let totalErrors = 0;
  let totalLatency = 0;
  let totalResults = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\nBatch ${i + 1}/${batches.length}: [${batch.join(", ")}]`);

    try {
      const data = await runBatch(batch);

      for (const r of data.results || []) {
        results.push(r);
        totalResults++;

        if (r.error) {
          totalErrors++;
          console.log(`  #${r.n}: ERROR ${r.error} (${r.latencyMs}ms)`);
        } else if (r.validation?.valid) {
          console.log(`  #${r.n}: ✓ (${r.latencyMs}ms)`);
        } else {
          console.log(`  #${r.n}: INVALID [${r.validation?.problems?.join(",")}] (${r.latencyMs}ms)`);
        }

        totalLatency += r.latencyMs || 0;
      }

      // Save after each batch
      writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    } catch (err) {
      console.error(`  Batch failed: ${err.message}`);
      totalErrors++;
    }

    // Rate limit between batches
    if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total results: ${totalResults}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Avg latency: ${totalResults > 0 ? Math.round(totalLatency / totalResults) : 0}ms`);
  console.log(`Results saved: ${resultsPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
