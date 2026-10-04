// REL-002 -- recorded repository fingerprint for the authoritative safe set.
//
// REL-002's recommended fix was explicit: "Establish R10 certification on a
// recorded repository fingerprint so both broad runs are attributable to the same
// bytes. Then, if a failure still appears on fixed bytes, treat it as a genuine
// flake and root-cause it rather than retrying."
//
// This computes exactly that fingerprint. It is deliberately conservative about
// what counts as "relevant bytes": every source file the safe set can read, and
// nothing that is a build artifact, a cache, or a runtime store.
//
// Usage:
//   node scripts/relevant-tree-fingerprint.mjs            # print the fingerprint
//   node scripts/relevant-tree-fingerprint.mjs --paths    # also list the files
//
// Volatile by design and EXCLUDED, because including any of them would make the
// fingerprint change for reasons unrelated to test outcomes:
//   node_modules/ dist/ .next/ .wrangler/ .sites-runtime/ test-results/
//   playwright-report/ graphify-out/ .git/ *.log
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const EXCLUDED_DIRS = new Set([
  "node_modules", "dist", ".next", ".wrangler", ".sites-runtime", "test-results",
  "playwright-report", "graphify-out", ".git", "coverage", ".turbo", ".cache",
]);

// These are the roots whose contents the safe suite can read or execute. The
// active migration chain is included because the safe set applies it to build
// throwaway databases, so a migration change absolutely changes suite outcomes.
const INCLUDED_ROOTS = ["tests", "app", "worker", "db", "drizzle-active", "scripts"];

// Individual files that change test outcomes but sit outside the roots above.
const INCLUDED_FILES = ["package.json", "scripts/test-classification-baseline.json"];

const walk = (dir, acc) => {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.endsWith(".log")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
};

const files = [];
for (const root of INCLUDED_ROOTS) walk(join(ROOT, root), files);
for (const file of INCLUDED_FILES) {
  try { statSync(join(ROOT, file)); files.push(join(ROOT, file)); } catch { /* absent */ }
}
files.sort();

const perFile = new Map();
for (const file of files) {
  perFile.set(relative(ROOT, file), createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16));
}

// The tree fingerprint is order-independent by construction (files are sorted) and
// path-sensitive, so a rename is a change even when content is identical.
const tree = createHash("sha256");
for (const [path, hash] of [...perFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  tree.update(`${path}:${hash}\n`);
}

const fingerprint = tree.digest("hex").slice(0, 16);
const out = { fingerprint, fileCount: perFile.size, at: new Date().toISOString() };

if (process.argv.includes("--paths")) out.files = Object.fromEntries(perFile);
console.log(JSON.stringify(out, null, 2));
