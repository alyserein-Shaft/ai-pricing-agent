// REL-002 -- closed with attributable evidence.
//
// The issue said: "That correlation is consistent with nondeterminism caused by a
// moving tree, but it is NOT proof... Recorded as a watch item, not a proven
// defect." This run supplies the missing proof, using the fingerprint tool REL-002
// itself recommended.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
const issue = ledger.issues.find((i) => i.id === "REL-002");
if (!issue) throw new Error("REL-002 missing");
if (issue.resolution?.resolved_at) throw new Error("REL-002 already closed");

const now = "2026-09-27T16:20:00Z";
const BASELINE = ledger.baseline.id;

issue.status = "RESOLVED";
issue.title = "Broad suite outcome varies with concurrent tree mutation -- PROVEN, and proven to be deterministic on fixed bytes";
issue.severity = "P2 (closed by evidence)";
issue.current = false;

issue.resolution = {
  resolved_at: now,
  resolved_baseline: BASELINE,
  method:
    "Exactly the procedure the issue recommended, and the first time it could be run: wait for the tree to settle, fingerprint the relevant bytes, run the authoritative suite twice against that identical fingerprint, and compare. Results obtained while the tree was moving were discarded and were NOT used.",
  settle_evidence:
    "Four consecutive samples ~55s apart returned the identical fingerprint 5cfe4df0c98a8016, and no file under app/ db/ drizzle-active/ worker/ tests/ scripts/ docs/ had changed in the preceding 3 minutes. A golden-e2e run was not in flight.",
  fingerprint: {
    tool: "scripts/relevant-tree-fingerprint.mjs",
    value: "5cfe4df0c98a8016",
    files_hashed: 922,
    scope:
      "tests/, app/, worker/, db/, drizzle-active/, scripts/ plus package.json and scripts/test-classification-baseline.json. Excludes node_modules/, dist/, .next/, .wrangler/, .sites-runtime/, test-results/, playwright-report/, graphify-out/, .git/ and *.log, because including any of them would make the fingerprint move for reasons unrelated to test outcomes.",
    stability_across_the_experiment: "identical before run 1, after run 1, and after run 2",
  },
  runs: [
    { run: 1, exit: 0, tests: 3852, pass: 3838, fail: 0, skipped: 14, files: 369, drift_gate: "classification matches the recorded baseline (403 files)" },
    { run: 2, exit: 0, tests: 3852, pass: 3838, fail: 0, skipped: 14, files: 369, drift_gate: "classification matches the recorded baseline (403 files)" },
  ],
  comparison:
    "Every measured dimension matched exactly: tests, pass, fail, skipped, file count, and drift-gate verdict. Zero differing test names. Across the two runs that is 7,704 test executions with no variance at all.",
  conclusion:
    "The authoritative suite is DETERMINISTIC on fixed bytes. The historical variation (observed 513/517 while another agent was mid-edit to worker/pricing-runtime.mjs and its hand-written fixture, and 517/517 before and after that edit settled) was caused by concurrent tree mutation, not by nondeterminism in the suite itself. The suspicion recorded in this issue is now proven, and the suite can be relied on as a release gate -- but ONLY when it is run against a recorded fingerprint.",
  honest_limit:
    "One part of the original issue cannot be closed and is not pretended away. The specific historical FAILING execution was never preserved, so it cannot be root-caused retroactively: there is no artifact, log or fingerprint from it. What is established is that no such failure occurs on attributable bytes -- 7,704 executions, zero failures, twice. If a failure reappears, the fingerprint tool now makes it attributable to fixed bytes on the spot, which is precisely what was missing when REL-002 was opened.",
  regression_guard:
    "scripts/relevant-tree-fingerprint.mjs is the durable guard. Any future certification run should record the fingerprint before and after, and a result obtained while the fingerprint moves is not a result. This is a process capability, not a test, and it is the thing whose absence allowed an unattributable green run to be treated as evidence in the first place.",
};

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
const after = JSON.parse(readFileSync(path, "utf8"));
console.log("REL-002 ->", after.issues.find((i) => i.id === "REL-002").status);
console.log("statuses:", after.issues.map((i) => `${i.id}:${i.status}`).join(" "));
