#!/usr/bin/env node
// Focused concurrency simulation for the .lore ownership model.
//
// Scope: continuity tooling only. This is NOT an application test and imports no
// application code. It runs the real merge algorithm (scripts/lore-consolidate.mjs)
// against throwaway fixture ledgers in a temp directory.
//
// Proves, deterministically:
//   1. a baseline shared ledger exists
//   2. Agent A produces delta A from that baseline
//   3. Agent B produces delta B from the SAME baseline
//   4. both reconcile
//   5. A's and B's entries both survive
//   6. pre-existing historical entries survive
//   7. duplicate replay is idempotent
//   8. a divergent same-ID conflict is refused (fail closed, nothing written)

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONSOLIDATE = join(REPO_ROOT, "scripts", "lore-consolidate.mjs");

let failures = 0;
function check(name, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ` -- ${detail}` : ""}`);
}

function ledgerPath(root, f) {
  return join(root, ".lore", f);
}

function writeLedger(root, rel, text) {
  const p = ledgerPath(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, "utf8");
}

function readLedger(root, rel) {
  return readFileSync(ledgerPath(root, rel), "utf8");
}

function idsOf(text) {
  const ids = new Set();
  for (const raw of text.split("\n")) {
    const b = raw.match(/^- \[((?:ARCH|DEC|CONV)-[A-Za-z0-9._-]+)\]/);
    if (b) ids.add(b[1]);
    const e = raw.match(/^- ((?:EV|EV-AUDIT)-[A-Za-z0-9._-]+) \|/);
    if (e) ids.add(e[1]);
  }
  return ids;
}

function writeShard(root, run, file, lines) {
  const d = join(root, ".lore", "runs", run);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, file), lines.join("\n") + "\n", "utf8");
}

function consolidate(root, run, apply) {
  const args = ["scripts/lore-consolidate.mjs", "--run", run];
  if (apply) args.push("--apply");
  try {
    const out = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? String(e) };
  }
}

// The real merge algorithm is copied into each throwaway root so that its
// REPO_ROOT resolution targets the fixture, never the actual repository.
function installConsolidator(root) {
  const d = join(root, "scripts");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "lore-consolidate.mjs"), readFileSync(CONSOLIDATE, "utf8"), "utf8");
}

const BASELINE_DEC = [
  "# Global Decisions",
  "",
  "- [DEC-2026-09-29-4999] Historical decision one. #added:2026-09-29",
  "- [DEC-2026-09-29-bf91] Historical decision two. #added:2026-09-29",
  "- [DEC-2026-09-29-7f14] Historical decision three. #added:2026-09-29",
].join("\n");

const BASELINE_EV = [
  "# Evidence Index",
  "",
  "## Records",
  "",
  "- EV-20260929-COMMPOLICY | Historical evidence one | test | x | y | 2026-09-29 | docs/a.md | none | VALID",
  "- EV-20260930-CK-FRESH-V2 | Historical evidence two | test | x | y | 2026-09-30 | docs/b.md | none | VALID",
].join("\n");

const DELTA_A = [
  "- [DEC-2026-10-02-a001] Agent A decision. #added:2026-10-02",
];
const DELTA_B = [
  "- [DEC-2026-10-02-b001] Agent B decision. #added:2026-10-02",
];
const DELTA_A_EV = [
  "- EV-20261002-AGENT-A-XYZ | Agent A evidence | test | x | y | 2026-10-02 | docs/c.md | none | VALID",
];

function scenario(name, fn) {
  const root = mkdtempSync(join(tmpdir(), "lore-sim-"));
  try {
    installConsolidator(root);
    writeLedger(root, "_global/DECISIONS.md", BASELINE_DEC);
    writeLedger(root, "EVIDENCE.md", BASELINE_EV);
    console.log(`\n${name}`);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
scenario("1. two agents branch from the same baseline and both reconcile", (root) => {
  writeShard(root, "agent-a", "DECISIONS.delta.md", DELTA_A);
  writeShard(root, "agent-a", "EVIDENCE.delta.md", DELTA_A_EV);
  writeShard(root, "agent-b", "DECISIONS.delta.md", DELTA_B);

  const a = consolidate(root, "agent-a", true);
  const b = consolidate(root, "agent-b", true);
  check("agent A consolidation succeeded", a.code === 0, a.err.trim().split("\n")[0] ?? "");
  check("agent B consolidation succeeded", b.code === 0, b.err.trim().split("\n")[0] ?? "");

  const dec = readLedger(root, "_global/DECISIONS.md");
  const ev = readLedger(root, "EVIDENCE.md");
  const decIds = idsOf(dec);
  const evIds = idsOf(ev);

  check("agent A entry survives", decIds.has("DEC-2026-10-02-a001"));
  check("agent B entry survives", decIds.has("DEC-2026-10-02-b001"));
  check("historical decision DEC-2026-09-29-4999 survives", decIds.has("DEC-2026-09-29-4999"));
  check("historical decision DEC-2026-09-29-bf91 survives", decIds.has("DEC-2026-09-29-bf91"));
  check("historical decision DEC-2026-09-29-7f14 survives", decIds.has("DEC-2026-09-29-7f14"));
  check("agent A evidence survives", evIds.has("EV-20261002-AGENT-A-XYZ"));
  check("historical evidence EV-20260929-COMMPOLICY survives", evIds.has("EV-20260929-COMMPOLICY"));
  check("historical evidence EV-20260930-CK-FRESH-V2 survives", evIds.has("EV-20260930-CK-FRESH-V2"));
  check("exactly 5 decision entries, none duplicated", decIds.size === 5, `got ${decIds.size}`);
  check("baseline header preserved", dec.startsWith("# Global Decisions"));
});

// ---------------------------------------------------------------------------
scenario("2. duplicate replay is idempotent", (root) => {
  writeShard(root, "agent-a", "DECISIONS.delta.md", DELTA_A);
  const first = consolidate(root, "agent-a", true);
  const afterFirst = readLedger(root, "_global/DECISIONS.md");
  const replay = consolidate(root, "agent-a", true);
  const afterReplay = readLedger(root, "_global/DECISIONS.md");

  check("first apply succeeded", first.code === 0);
  check("replay apply succeeded", replay.code === 0);
  check("replay reported no-op", /no-op/.test(replay.out), replay.out.trim().split("\n").pop());
  check("file byte-identical after replay", afterFirst === afterReplay);
  check("entry count unchanged", idsOf(afterReplay).size === 4, `got ${idsOf(afterReplay).size}`);
});

// ---------------------------------------------------------------------------
scenario("3. divergent same-ID conflict is refused and nothing is written", (root) => {
  writeShard(root, "agent-a", "DECISIONS.delta.md", DELTA_A);
  const first = consolidate(root, "agent-a", true);
  const before = readLedger(root, "_global/DECISIONS.md");

  writeShard(root, "agent-b", "DECISIONS.delta.md", [
    "- [DEC-2026-10-02-a001] Agent B disagrees about the same entry ID. #added:2026-10-02",
  ]);
  const conflict = consolidate(root, "agent-b", true);
  const after = readLedger(root, "_global/DECISIONS.md");

  check("first apply succeeded", first.code === 0);
  check("conflicting consolidation exits non-zero", conflict.code !== 0);
  check("conflict reported as fail-closed", /LORE CONFLICT \(fail closed\)/.test(conflict.err));
  check("target file unchanged", before === after);
  check("no silent winner chosen", after.includes("Agent A decision") && !after.includes("disagrees"));
});

// ---------------------------------------------------------------------------
scenario("4. a foreign agent's concurrent addition is preserved, not clobbered", (root) => {
  writeShard(root, "agent-a", "DECISIONS.delta.md", DELTA_A);
  // Agent B appends straight to the shared ledger while agent A's shard is still
  // pending consolidation. A must merge, not replace.
  writeLedger(
    root,
    "_global/DECISIONS.md",
    `${BASELINE_DEC}\n- [DEC-2026-10-02-foreign] Foreign concurrent entry. #added:2026-10-02\n`,
  );

  const a = consolidate(root, "agent-a", true);
  const dec = readLedger(root, "_global/DECISIONS.md");
  const decIds = idsOf(dec);

  check("agent A consolidation succeeded", a.code === 0, a.err.trim().split("\n")[0] ?? "");
  check("foreign concurrent entry preserved", decIds.has("DEC-2026-10-02-foreign"));
  check("agent A entry added", decIds.has("DEC-2026-10-02-a001"));
  check("historical entries preserved", decIds.has("DEC-2026-09-29-4999"));
  check("no shrinkage", decIds.size === 5, `got ${decIds.size}`);
});

// ---------------------------------------------------------------------------
scenario("5. shrinkage since the run baseline is refused", (root) => {
  writeShard(root, "agent-a", "DECISIONS.delta.md", DELTA_A);
  // Record the baseline the way an agent does at bootstrap.
  const baselineIds = [...idsOf(BASELINE_DEC)];
  writeFileSync(
    join(root, ".lore", "runs", "agent-a", "MANIFEST.json"),
    JSON.stringify(
      { run: "agent-a", baselines: { ".lore/_global/DECISIONS.md": { sha256: "stale-baseline-hash", ids: baselineIds } } },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  // A historical entry then disappears from the shared ledger.
  writeLedger(
    root,
    "_global/DECISIONS.md",
    BASELINE_DEC.split("\n").filter((l) => !l.includes("bf91")).join("\n"),
  );

  const r = consolidate(root, "agent-a", true);
  const dec = readLedger(root, "_global/DECISIONS.md");
  check("shrinkage refused", r.code !== 0);
  check("refusal names the lost baseline entry", /bf91/.test(r.err));
  check("nothing was written", !dec.includes("a001"));
  check("loss is still visible, not hidden", !dec.includes("bf91"));
});

// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? "\nLORE CONCURRENCY SIMULATION: ALL CHECKS PASSED"
    : `\nLORE CONCURRENCY SIMULATION: ${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
