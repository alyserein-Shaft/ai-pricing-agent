#!/usr/bin/env node
// Lore consolidation: merge per-agent delta shards into the shared global ledgers.
//
// Ownership model (see .agents/skills/ai-pricing-agent-workflow/SKILL.md section 21.7):
//   - Every agent/session writes ONLY its own delta shard under .lore/runs/<run-id>/.
//   - Shared ledgers are aggregation targets, not working files.
//   - This script is the ONE controlled merge step. It re-reads each target
//     immediately before mutation, merges only the delta, writes atomically, and
//     verifies that no pre-existing entry disappeared.
//   - Ambiguous conflicts FAIL CLOSED. It never picks one agent's version.
//
// A delta shard is a Markdown file that reuses the TARGET ledger's native line
// format verbatim, so merging is line-level and needs no new schema:
//   .lore/runs/<run-id>/DECISIONS.delta.md      -> .lore/_global/DECISIONS.md
//   .lore/runs/<run-id>/CONVENTIONS.delta.md    -> .lore/_global/CONVENTIONS.md
//   .lore/runs/<run-id>/ARCHITECTURE.delta.md   -> .lore/_global/ARCHITECTURE.md
//   .lore/runs/<run-id>/EVIDENCE.delta.md       -> .lore/EVIDENCE.md
//   .lore/runs/<run-id>/SUMMARY.delta.md        -> .lore/SUMMARY.md  (digest append)
//
// Usage:
//   node scripts/lore-consolidate.mjs --run <run-id>            # dry run (default)
//   node scripts/lore-consolidate.mjs --run <run-id> --apply    # perform the merge
//
// Exit codes: 0 ok, 1 conflict / verification failure (nothing was written), 2 usage.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_DIR = join(REPO_ROOT, ".lore", "runs");

// shard file -> { target, kind }
// kind "ledger"  : native bullet records with a stable bracketed ID
// kind "digest"  : SUMMARY prose lines keyed by the entry anchors they cite
const SHARDS = [
  { shard: "ARCHITECTURE.delta.md", target: ".lore/_global/ARCHITECTURE.md", kind: "ledger", idPrefix: "ARCH-" },
  { shard: "DECISIONS.delta.md", target: ".lore/_global/DECISIONS.md", kind: "ledger", idPrefix: "DEC-" },
  { shard: "CONVENTIONS.delta.md", target: ".lore/_global/CONVENTIONS.md", kind: "ledger", idPrefix: "CONV-" },
  { shard: "EVIDENCE.delta.md", target: ".lore/EVIDENCE.md", kind: "ledger", idPrefix: null },
  { shard: "SUMMARY.delta.md", target: ".lore/SUMMARY.md", kind: "digest", idPrefix: null },
];

// Stable IDs.
//   - bullet ledgers:  - [DEC-2026-10-01-4c15] text
//   - evidence index:  - EV-2026... | scope | type | ...
//   - summaries:        any prose line, keyed by the entry anchors it cites
const BULLET_ID = /^- \[((?:ARCH|DEC|CONV)-[A-Za-z0-9._-]+)\](.*)$/;
const EVIDENCE_ID = /^- ((?:EV|EV-AUDIT)-[A-Za-z0-9._-]+)( \|.*)$/;
const ANCHOR = /\[_global\/[A-Z]+\.md#((?:ARCH|DEC|CONV)-[A-Za-z0-9._-]+)\]/g;

function lineId(raw, kind) {
  if (kind === "digest") {
    const anchors = [...raw.matchAll(ANCHOR)].map((m) => m[1]).sort();
    return anchors.length ? `anchor:${anchors.join("+")}` : null;
  }
  const bullet = raw.match(BULLET_ID);
  if (bullet) return bullet[1];
  const ev = raw.match(EVIDENCE_ID);
  if (ev) return ev[1];
  return null;
}

function normalise(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

function parseLedger(text, kind, idPrefix) {
  const entries = new Map();
  const problems = [];
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    if (raw.trim() === "") return;
    if (raw.startsWith("#")) return; // header prose, preserved verbatim
    const id = lineId(raw, kind);
    if (!id) {
      // A non-entry line is tolerated in the target (historic formatting) but is
      // NEVER tolerated in a delta shard: an unidentifiable record cannot be merged
      // deterministically, so a shard containing one is a hard conflict.
      problems.push({ line: i + 1, reason: "unidentifiable-entry", text: raw.slice(0, 120) });
      return;
    }
    if (idPrefix && !id.startsWith(idPrefix)) {
      problems.push({ line: i + 1, reason: `expected-id-prefix-${idPrefix}`, text: id });
      return;
    }
    if (entries.has(id)) {
      problems.push({ line: i + 1, reason: "duplicate-id-in-source", text: id });
      return;
    }
    entries.set(id, raw);
  });
  return { entries, problems, lines };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// Atomic write: same-directory temp file + rename, so a reader never observes a
// half-written ledger.
function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

function fail(message, details = []) {
  console.error(`LORE CONFLICT (fail closed): ${message}`);
  for (const d of details) console.error(`  - ${typeof d === "string" ? d : JSON.stringify(d)}`);
  console.error("Nothing was written. Resolve the conflict explicitly, then re-run.");
  process.exit(1);
}

function parseArgs(argv) {
  const out = { apply: false, run: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") out.apply = true;
    else if (argv[i] === "--run") out.run = argv[i + 1] ?? null;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: node scripts/lore-consolidate.mjs --run <run-id> [--apply]");
      process.exit(0);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.run) fail("missing --run <run-id>");
  if (!/^[A-Za-z0-9._-]+$/.test(args.run)) fail(`unsafe run id: ${args.run}`);

  const runDir = join(RUNS_DIR, args.run);
  if (!existsSync(runDir)) fail(`no delta shard directory for run "${args.run}" (${runDir})`);

  const manifestPath = join(runDir, "MANIFEST.json");
  const manifestText = readIfExists(manifestPath);
  let manifest = null;
  if (manifestText !== null) {
    try {
      manifest = JSON.parse(manifestText);
    } catch (e) {
      fail(`MANIFEST.json in ${runDir} is not valid JSON: ${e.message}`);
    }
  }

  const plans = [];
  for (const spec of SHARDS) {
    const shardPath = join(runDir, spec.shard);
    if (!existsSync(shardPath)) continue;

    const shardText = readFileSync(shardPath, "utf8");
    const targetPath = join(REPO_ROOT, spec.target);

    // --- 1. initial read of the shared target -------------------------------
    const initialText = readIfExists(targetPath) ?? "";
    const initial = parseLedger(initialText, spec.kind, spec.idPrefix);
    const shard = parseLedger(shardText, spec.kind, spec.idPrefix);

    if (shard.problems.length) {
      fail(`${spec.shard} contains entries that cannot be merged deterministically`, shard.problems);
    }

    // --- 2. conflict detection against the target ---------------------------
    const divergent = [];
    const replay = [];
    const additive = [];
    for (const [id, raw] of shard.entries) {
      const existing = initial.entries.get(id);
      if (existing === undefined) additive.push({ id, raw });
      else if (normalise(existing) === normalise(raw)) replay.push({ id });
      else divergent.push({ id, existing, incoming: raw });
    }
    if (divergent.length) {
      fail(
        `${spec.shard} diverges from the shared ${spec.target} on ${divergent.length} entr(y|ies) with the SAME id`,
        divergent.map((d) => ({
          id: d.id,
          shared: d.existing.slice(0, 200),
          delta: d.incoming.slice(0, 200),
        })),
      );
    }

    // --- 3. shrinkage detection against the run's own baseline --------------
    if (manifest?.baselines?.[spec.target]) {
      const liveHash = sha256(initialText);
      if (liveHash !== manifest.baselines[spec.target].sha256) {
        const baseIds = new Set(manifest.baselines[spec.target].ids ?? []);
        const lost = [...baseIds].filter((id) => !initial.entries.has(id));
        fail(
          `${spec.target} changed since run "${args.run}" recorded its baseline; refusing to merge over unknown foreign edits`
          + (lost.length ? ` (baseline entries now missing: ${lost.join(", ")})` : ""),
        );
      }
    }

    if (additive.length === 0) {
      plans.push({
        spec,
        noop: true,
        label: "no-op (already consolidated)",
        additive: [],
        replay: replay.length,
        targetPath,
        initialText,
      });
      continue;
    }

    plans.push({
      spec,
      noop: false,
      label: "merge",
      additive,
      additiveCount: additive.length,
      replay: replay.length,
      targetPath,
      initialText,
      initialEntryIds: [...initial.entries.keys()],
    });
  }

  if (plans.length === 0) fail(`run "${args.run}" contains no *.delta.md shards to consolidate`);

  // --- 4. report / dry run -------------------------------------------------
  console.log(`run=${args.run} mode=${args.apply ? "APPLY" : "DRY-RUN"}`);
  for (const p of plans) {
    console.log(
      `  ${p.spec.target}: ${p.label}` +
        ` (+${p.additive.length} new, ${p.replay} idempotent-replay)`,
    );
  }
  if (!args.apply) {
    console.log("Dry run only. Re-run with --apply to consolidate.");
    return;
  }

  // --- 5. re-read immediately before mutation, then merge atomically -------
  for (const p of plans) {
    if (p.noop) continue;

    // Foreign-addition preservation: anything appended/changed by another agent
    // between our initial read and now is re-read and kept.
    const justBefore = readIfExists(p.targetPath) ?? "";
    let fresh;
    if (justBefore !== p.initialText) {
      const nowParsed = parseLedger(justBefore, p.spec.kind, p.spec.idPrefix);
      const vanished = p.initialEntryIds.filter((id) => !nowParsed.entries.has(id));
      if (vanished.length) {
        fail(
          `${p.spec.target} lost ${vanished.length} entry/entries between the initial read and the write; refusing to continue`,
          vanished,
        );
      }
      // Re-validate the delta against the fresher view before writing.
      for (const a of p.additive) {
        const existing = nowParsed.entries.get(a.id);
        if (existing !== undefined && normalise(existing) !== normalise(a.raw)) {
          fail(`${p.spec.target} gained a divergent entry for ${a.id} during consolidation`, {
            id: a.id,
            shared: existing.slice(0, 200),
            delta: a.raw.slice(0, 200),
          });
        }
      }
      fresh = nowParsed.entries;
    } else {
      fresh = parseLedger(justBefore, p.spec.kind, p.spec.idPrefix).entries;
    }

    // Only the current run's additive delta is written. Every foreign entry read
    // above is preserved because `justBefore` is the base, not an in-memory snapshot.
    const toWrite = p.additive.filter((a) => fresh.get(a.id) === undefined);
    const eol = justBefore.endsWith("\n") ? "" : "\n";
    p.merge = {
      text: `${justBefore}${eol}${toWrite.map((a) => a.raw).join("\n")}\n`,
      ids: toWrite.map((a) => a.id),
    };

    writeAtomic(p.targetPath, p.merge.text);

    // --- 6. verify nothing disappeared -------------------------------------
    const after = parseLedger(readIfExists(p.targetPath) ?? "", p.spec.kind, p.spec.idPrefix);
    const lost = [...new Set([...p.initialEntryIds, ...p.merge.ids])].filter((id) => !after.entries.has(id));
    if (lost.length) {
      fail(
        `post-write verification of ${p.spec.target} found ${lost.length} missing entry/entries (merged=${p.merge.ids.length})`,
        lost,
      );
    }
    console.log(
      `  WROTE ${p.spec.target}: +${p.merge.ids.length} entries, all ${after.entries.size} entries present`,
    );
  }
  console.log("Consolidation complete.");
}

main();
