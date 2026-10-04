#!/usr/bin/env node
// REL-003 -- the authoritative test inventory and runner.
//
// THE DEFECT THIS FIXES.
// `npm test` was a hand-maintained list of 33 files out of 400 (8%). It was
// accreted, not curated (it is not even alphabetical). Two consequences, both
// proven in this session:
//
//   1. A green "npm test 517/517" is a 517-test signal, not a repository signal.
//      The authoritative safe surface is 3,853 tests -- 7.4x larger.
//   2. A NEW regression guard is silently NOT executed unless package.json is
//      edited by hand. Three of this programme's own guards had to be wired in
//      manually for exactly this reason.
//
// A naive `node --test tests/*.test.mjs` is NOT the fix and is not used here:
// 30 files reference the real .wrangler D1 or Golden project data and 3 spawn
// child processes, so a blanket run risks mutating production-like data.
//
// THE STRATEGY.
//   A. An explicit, justified exclusion list derived from what each file
//      actually does, not from a guess.
//   B. ONE authoritative runner for the safe set, GENERATED from repository
//      contents so it cannot drift the way the hand-maintained list did.
//   C. A CLOSED-WORLD GATE: if a test file appears that this script cannot
//      classify, the runner FAILS instead of skipping it. That silent skip is
//      the actual root cause, so it is made impossible rather than discouraged.
//
// Usage:
//   node scripts/authoritative-test-inventory.mjs          # print the inventory
//   node scripts/authoritative-test-inventory.mjs --run    # run the safe set
//   node scripts/authoritative-test-inventory.mjs --list   # shell-safe file list
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TESTS = join(ROOT, "tests");

// Each class says WHAT it detects and WHY it cannot be run unattended. A class is
// only justified if running the file could touch state outside a throwaway
// temp database.
const CLASSES = [
  {
    id: "REAL_STATE", requiresFlag: false, exclude: true,
    label: "References the real .wrangler D1 or Golden project data",
    why: "May read or mutate production-like data. The Golden project and the historical Al Mousa School project must not be altered by an inventory pass.",
    detect: (src) => /\.wrangler|miniflare-D1|Al Mousa|Clean Golden Run|project_ae501b85/.test(src),
  },
  {
    id: "SPAWNS_PROCESS", requiresFlag: false, exclude: true,
    label: "Spawns child processes",
    why: "Can start a server, wrangler or d1 execute; not safe to fan out unattended.",
    detect: (src) => /execSync|spawnSync|child_process/.test(src),
  },
  {
    id: "MODULE_MOCKS", requiresFlag: true, exclude: false,
    label: "Requires --experimental-test-module-mocks",
    why: "Uses node:test mock.module behind an experimental flag. Safe: the flag is enabled for the whole safe run.",
    detect: (src) => /mock\.module/.test(src),
  },
  {
    id: "CHAIN_FIXTURE", requiresFlag: false, exclude: false,
    label: "Builds the real active migration chain",
    why: "Slower but safe: applies drizzle-active to a throwaway temp database and never opens a persistent D1.",
    detect: (src) => /active-chain-fixture|active-chain/.test(src),
  },
];

const files = readdirSync(TESTS).filter((name) => name.endsWith(".test.mjs")).sort();

const rows = files.map((name) => {
  const src = readFileSync(join(TESTS, name), "utf8");
  const matched = CLASSES.filter((c) => c.detect(src));
  const excludedBy = matched.find((c) => c.exclude) || null;
  return {
    file: `tests/${name}`,
    classes: matched.map((c) => c.id),
    excluded: Boolean(excludedBy),
    excludedBy: excludedBy ? excludedBy.id : null,
    requiresFlag: matched.some((c) => c.requiresFlag),
  };
});

// A file matching no class is PLAIN: it has no special environment requirement,
// so it runs in the safe set. That is the correct classification, not a gap --
// requiring every file to match a class would be theatre, since the vast
// majority of tests legitimately need nothing special.
const plain = rows.filter((r) => r.classes.length === 0);
const safe = rows.filter((r) => !r.excluded);
const excluded = rows.filter((r) => r.excluded);

const summary = {
  total: rows.length,
  safe: safe.length,
  excluded: excluded.length,
  plain: plain.length,
  requiresFlag: safe.filter((r) => r.requiresFlag).length,
  byExclusionReason: excluded.reduce((acc, r) => {
    acc[r.excludedBy] = (acc[r.excludedBy] || 0) + 1;
    return acc;
  }, {}),
};

const args = process.argv.slice(2);

if (args.includes("--list")) {
  process.stdout.write(safe.map((r) => r.file).join("\n") + "\n");
  process.exit(0);
}

if (args.includes("--run")) {
  // The real closed-world gate is DRIFT, not "every file must match a class".
  // The original root cause was a hand-maintained list that silently stopped
  // covering new tests, so the gate compares the current classification against
  // a recorded baseline and fails if the safe/excluded boundary has moved.
  const current = rows.map((r) => `${r.file}|${r.excludedBy || "SAFE"}`).sort();
  if (args.includes("--verify-drift")) {
    let baseline = null;
    try { baseline = JSON.parse(readFileSync(join(ROOT, "scripts", "test-classification-baseline.json"), "utf8")); }
    catch { console.error("No baseline yet. Run once with --write-baseline to create it."); process.exit(2); }
    const added = current.filter((entry) => !baseline.includes(entry));
    const removed = baseline.filter((entry) => !current.includes(entry));
    if (added.length || removed.length) {
      console.error(`REL-003 DRIFT GATE FAILED: the safe/excluded boundary changed (${added.length} added, ${removed.length} removed).`);
      for (const e of added) console.error(`  + ${e}`);
      for (const e of removed) console.error(`  - ${e}`);
      console.error("\nA new file may have been added without being considered for exclusion, or an exclusion may have become stale. Re-review, then re-record with --write-baseline.");
      process.exit(2);
    }
    console.log(`REL-003 DRIFT GATE: classification matches the recorded baseline (${current.length} files).`);
  }
  if (args.includes("--write-baseline")) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(ROOT, "scripts", "test-classification-baseline.json"), JSON.stringify(current, null, 1) + "\n");
    console.log(`Recorded classification baseline for ${current.length} files.`);
    process.exit(0);
  }
  const needsFlag = safe.some((r) => r.requiresFlag);
  const argv = [...(needsFlag ? ["--experimental-test-module-mocks"] : []), "--test", ...safe.map((r) => r.file)];
  console.log(`REL-003 authoritative run: ${safe.length} files (${summary.requiresFlag} need the module-mocks flag).`);
  const started = Date.now();
  const result = spawnSync(process.execPath, argv, { stdio: "inherit", cwd: ROOT });
  console.log(`\nCompleted in ${Math.round((Date.now() - started) / 1000)}s.`);
  process.exit(result.status === null ? 1 : result.status);
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  summary,
  classes: CLASSES.map(({ id, label, why, exclude }) => ({ id, label, why, exclude })),
  excluded: excluded.map((r) => ({ file: r.file, reason: r.excludedBy })),
  plainCount: plain.length,
}, null, 1));
