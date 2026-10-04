#!/usr/bin/env node
// Quiescence watcher. Fails closed.
//
// Requires the aggregate fingerprint to be UNCHANGED across N consecutive
// observations, AND requires the newest mtime across the critical set to be at
// least MIN_SETTLE_SECONDS old at the moment quiescence is declared -- so a
// writer that just stopped is not mistaken for a tree that was never moving.
//
// Usage: node .local-evidence/wait-quiescent.mjs [observations] [intervalSec] [settleSec]
// Exit 0 = quiescent. Exit 3 = timed out (still moving). Exit 2 = invalid evidence.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HERE = new URL(".", import.meta.url).pathname;
const FINGERPRINT = `${HERE}fingerprint.mjs`;
// CRITICAL_LIST selects the file set. EXPECT_FILE_COUNT is mandatory: without
// it this script cannot tell whether it watched the set it was asked to watch.
//
// This exists because the list-selection was silently wrong twice: a
// "tree-wide" run fell back to the 37-file default because the env var was
// never set, printed a confident QUIESCENT verdict, and that verdict was read
// as a quiescent tree. A success verdict must now be falsifiable against the
// requested scope.
const LIST = process.env.CRITICAL_LIST ?? `${HERE}critical-files.txt`;

const EXPECT = process.env.EXPECT_FILE_COUNT;
if (EXPECT === undefined) {
  console.log(
    "INVALID_EVIDENCE: EXPECT_FILE_COUNT is required. " +
      "Set it to the number of files the list is expected to contain, " +
      "so a silent fallback to a different set cannot report success.",
  );
  process.exit(2);
}
const EXPECT_N = Number(EXPECT);
if (!Number.isInteger(EXPECT_N) || EXPECT_N <= 0) {
  console.log(`INVALID_EVIDENCE: EXPECT_FILE_COUNT is not a positive integer: ${EXPECT}`);
  process.exit(2);
}

const observations = Number(process.argv[2] ?? 4);
const intervalSec = Number(process.argv[3] ?? 20);
const settleSec = Number(process.argv[4] ?? 60);

const files = readFileSync(LIST, "utf8")
  .split("\n")
  .map((l) => l.replace(/#.*$/, "").trim())
  .filter(Boolean);

if (files.length === 0) {
  console.log("INVALID_EVIDENCE: critical-files.txt yielded an empty list");
  process.exit(2);
}

function observe() {
  // execFileSync THROWS when the fingerprint exits non-zero (its fail-closed
  // path). That throw must surface as clean INVALID_EVIDENCE, not an
  // unhandled stack trace -- an unhandled throw here previously exited with a
  // bare stack and no machine-readable verdict.
  let out;
  try {
    out = execFileSync(process.execPath, [FINGERPRINT, ...files], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stdout = err?.stdout ?? "";
    let reason = "FINGERPRINT_COMMAND_FAILED";
    let detail = err?.message ?? String(err);
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.status === "INVALID_EVIDENCE") {
        reason = parsed.reason;
        detail = parsed.detail ?? detail;
      }
    } catch {
      // keep the exec error as the detail
    }
    console.log(`INVALID_EVIDENCE: ${reason} ${detail}`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    console.log("INVALID_EVIDENCE: fingerprint output was not JSON");
    process.exit(2);
  }
  if (parsed.status !== "OK") {
    console.log(`INVALID_EVIDENCE: ${parsed.reason} ${parsed.detail ?? ""}`);
    process.exit(2);
  }
  // The scope actually observed must equal the scope requested.
  if (parsed.fileCount !== EXPECT_N) {
    console.log(
      `INVALID_EVIDENCE: FILE_COUNT_MISMATCH observed ${parsed.fileCount} files, ` +
        `expected ${EXPECT_N}. The list resolved to a different set than intended; ` +
        `refusing to report quiescence for the wrong scope.`,
    );
    process.exit(2);
  }
  return parsed;
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// `prev` holds the previous AGGREGATE STRING. Comparing a string against
// `prev.aggregateSha256` (undefined) once made `changed` permanently true,
// which would have made a moving tree look stable. Compare strings directly.
let prevAgg = null;
let stableObservations = 0;
const MAX = 40;

for (let i = 1; i <= MAX; i += 1) {
  const cur = observe();
  const changed = prevAgg !== null && prevAgg !== cur.aggregateSha256;
  if (prevAgg === null || changed) stableObservations = 0;
  else stableObservations += 1;
  const ageSec = Math.round((Date.now() - cur.latestMtimeMs) / 1000);
  console.log(
    `probe ${String(i).padStart(2)}  agg=${cur.aggregateSha256.slice(0, 16)}  ` +
      `files=${cur.fileCount}  changed=${changed}  stable=${stableObservations}  newest_age=${ageSec}s`,
  );
  if (stableObservations + 1 >= observations && ageSec >= settleSec) {
    console.log(
      `\nQUIESCENT: aggregate stable across ${observations} consecutive observations; ` +
        `the newest observed mtime is ${ageSec}s old (>= ${settleSec}s required).`,
    );
    console.log(`scope=${cur.fileCount} files (expected ${EXPECT_N}, verified)`);
    console.log(`list=${LIST}`);
    console.log(`aggregate=${cur.aggregateSha256}`);
    process.exit(0);
  }
  prevAgg = cur.aggregateSha256;
  await sleep(intervalSec);
}

console.log("\nNOT QUIESCENT: tree still moving within the observation budget.");
process.exit(3);
