// REL-005 -- the readiness probe advertised a LEGACY migration tag.
// Also records the proven, structural Production Readiness ceiling.
import { readFileSync, writeFileSync } from "node:fs";

const path = "graphify-out/system-audit/system-risk-ledger.json";
const ledger = JSON.parse(readFileSync(path, "utf8"));
if (ledger.issues.some((i) => i.id === "REL-005")) throw new Error("REL-005 already present");
if (ledger.production_readiness) throw new Error("production_readiness already recorded");

const now = "2026-09-27T15:20:00Z";
const BASELINE = ledger.baseline.id;

ledger.issues.push({
  id: "REL-005",
  title: "The live readiness probe reported a LEGACY migration tag that is not in the active chain",
  domain: "Reliability / Production Readiness",
  severity: "P1 - a production readiness signal stated the wrong migration authority, and nothing else checked it",
  status: "RESOLVED",
  issue_class: "READINESS_SIGNAL_DEFECT",
  summary:
    "GET /api/health/ready reported migrationVersion '0014_task9_fire_alarm_library'. That tag belongs to the FROZEN LEGACY drizzle/ chain: it does not exist in drizzle-active/ at all, and docs/migration-baseline-adoption.md forbids replaying the legacy chain. The real active chain head is 0011_requirement_intelligence_constraint_restore. So the endpoint that exists to tell an operator whether this deployment is correctly migrated was naming a migration the deployment can never be at, from a chain that must never be applied. The number is also misleading on its face: 0014 > 0011 lexically, so an automated check would conclude the database is AHEAD of the deployed chain, when in truth the two numbers belong to unrelated chains and mean nothing to each other.",
  evidence: [
    {
      type: "RUNTIME",
      path: "GET http://localhost:4183/api/health/ready",
      symbol: "migrationVersion",
      observation:
        "BEFORE: {\"status\":\"pass\",\"applicationVersion\":\"16.0.0-alpha\",\"migrationVersion\":\"0014_task9_fire_alarm_library\",\"dependencies\":{\"database\":{\"status\":\"pass\",\"required\":26,\"present\":26,\"missing\":[]},\"storage\":{\"status\":\"configured\"}}} -- reported alongside status 'pass', i.e. the wrong version was reported as healthy.",
    },
    {
      type: "SOURCE",
      path: "app/domain/production-readiness.mjs",
      symbol: "MIGRATION_VERSION",
      observation: "was the literal \"0014_task9_fire_alarm_library\" (line 2).",
    },
    {
      type: "SOURCE",
      path: "drizzle-active/meta/_journal.json",
      symbol: "entries[last].tag",
      observation: "0011_requirement_intelligence_constraint_restore -- the actual active chain head.",
    },
    {
      type: "SOURCE",
      path: "drizzle-active/",
      symbol: "directory listing",
      observation: "contains no 0014_* file. 0014_task9_fire_alarm_library exists only under drizzle/, and is cited by drizzle-active/manifest.json solely as the frozen legacy source of objects the 0000 baseline adopted.",
    },
    {
      type: "SOURCE",
      path: "worker/production-readiness-api.mjs",
      symbol: "/api/health/ready",
      observation:
        "the readiness check verifies only that 26 required TABLES are present (READINESS_REQUIRED_TABLES). It never compares a schema or migration version, so nothing else in the system would ever have caught this.",
    },
  ],
  production_path: [
    "deployment is migrated to the active chain",
    "operator or automated check reads /api/health/ready",
    "the response names a legacy drizzle/ tag and reports status 'pass'",
    "the operator concludes the wrong thing about migration state, and any check keyed on the value compares against a chain that must not be applied",
  ],
  affected_routes: ["GET /api/health/ready"],
  affected_tables: [],
  affected_domains: ["Reliability", "Production Readiness", "Database"],
  impact: {
    engineering:
      "A readiness signal is a claim about the deployment. This one was confidently wrong, and it was wrong in the most dangerous direction: it accompanied status 'pass'.",
    commercial: "None directly.",
    governance:
      "This is the same class as DOC-001: one question ('which migration version governs this deployment?') had a legacy answer and an active-chain answer, and the legacy one was the one being published.",
    data_integrity: "None. No migration was applied, no schema changed, no row written.",
  },
  reproduction:
    "curl -s localhost:4183/api/health/ready | grep migrationVersion, and compare against the last entry of drizzle-active/meta/_journal.json and against `ls drizzle-active/`.",
  tests_covering: [
    { test: "tests/migration-chain-verification.test.mjs", assertion: "new test: the readiness probe reports the ACTIVE chain head as its migration version, never a legacy tag (3/3 pass)" },
    { test: "tests/production-readiness.test.mjs", assertion: "10/10 pass" },
  ],
  tests_missing: [],
  confidence: "HIGH",
  blocking_stage: ["PRE_PRODUCTION", "PRODUCTION"],
  recommended_fix:
    "DONE. MIGRATION_VERSION now names the active chain head, 0011_requirement_intelligence_constraint_restore. Because a literal cannot stay correct across migrations -- the exact rot class behind DB-003 -- the value is now guarded rather than trusted: tests/migration-chain-verification.test.mjs reads the Drizzle journal and asserts MIGRATION_VERSION equals its last entry, that a file of that name exists in drizzle-active/, and that a tag which exists only in the frozen legacy chain can never be reported. The next appended migration fails that test until the constant is advanced, loudly and by design.",
  owner_lane: "N",
  related_issues: ["DB-002", "DB-003", "DB-004", "DOC-001"],
  source_fingerprints: ["app/domain/production-readiness.mjs@MIGRATION_VERSION"],
  graph: { nodes: [], paths: [], communities: [] },
  resolution: {
    resolved_at: now,
    resolved_baseline: BASELINE,
    resolution_evidence: [
      "RUNTIME AFTER: GET /api/health/ready -> {\"status\":\"pass\",\"migrationVersion\":\"0011_requirement_intelligence_constraint_restore\"} matching the journal head exactly, with database 26/26 present and storage configured",
      "tests/migration-chain-verification.test.mjs 3/3 pass",
      "tests/production-readiness.test.mjs 10/10 pass",
    ],
    regression_guard:
      "tests/migration-chain-verification.test.mjs :: 'the readiness probe reports the ACTIVE chain head as its migration version, never a legacy tag'",
  },
  current: false,
  first_seen_baseline: BASELINE,
  last_seen_baseline: BASELINE,
  first_seen_at: now,
  last_seen_at: now,
});

ledger.production_readiness = {
  assessed_at: now,
  method:
    "The gate was enumerated exhaustively rather than sampled: all 2^9 = 512 combinations of the nine boolean criteria were evaluated with unresolvedSeverity1 = 0, and the highest attainable level was determined from the real module, not from its documentation.",
  declared_levels: ["Not Ready", "Internal Alpha Ready", "Controlled Pilot Ready", "Beta Ready", "Production Candidate", "Production Ready"],
  reachable_levels: ["Not Ready", "Functional Prototype", "Internal Alpha Ready", "Controlled Pilot Ready", "Beta Ready", "Production Candidate"],
  unreachable_levels: ["Production Ready"],
  ceiling: {
    level: "Production Candidate",
    sole_remaining_blocker: "Independent production approval and live operational validation required",
    proof:
      "releaseGate returns 'Production Candidate' for every criterion true, and 'Production Ready' is returned by NO input. The function has no branch that can produce it.",
    interpretation:
      "This is correct governance rather than a gap, and it must not be 'fixed'. The terminal level is deliberately reserved for an act that code cannot perform: an independent approval plus live operational validation. Any future change that made the code self-certify Production Ready would be a governance regression, so the ceiling is now pinned by an exhaustive-enumeration guard (tests/production-readiness.test.mjs :: PR-CEILED) and by a Severity-1 precedence guard (PR-CEILING-EVIDENCE).",
  },
  operational_criteria_are_external: {
    note:
      "Every criterion above coreWorkflow/criticalSafety/dataIntegrity is an organizational fact rather than a code artifact, and none of them is established anywhere in this repository.",
    criteria: {
      backupRestore: "requires an executed backup-and-restore drill with checksums against a real target",
      monitoring: "requires deployed monitoring and alerting",
      staging: "requires a staging environment",
      security: "requires an independent security review",
      recovery: "requires a recovery exercise (RTO/RPO proven)",
      performance: "requires a performance test against agreed thresholds",
    },
    honest_limit:
      "This assessment establishes the CEILING of the gate and the correctness of the one signal that was wrong (REL-005). It does NOT assert that backupRestore, monitoring, staging, security, recovery or performance are met. Asserting any of them without a drill, a deployment, a review or a measurement would be manufacturing authority, which this programme forbids.",
  },
  current_standing: {
    code_evidence: "Engineering criteria (coreWorkflow, criticalSafety, dataIntegrity) are covered by the authoritative suite: 0 failures, 0 unresolved Severity 1 findings in the ledger.",
    operational_evidence: "NOT ESTABLISHED. Unknown, not assumed in either direction.",
    statement:
      "On code evidence alone this system sits at the 'Production Candidate' ceiling with operational evidence outstanding. It cannot honestly be reported as PRODUCTION READY, and by construction it cannot be made so from code.",
  },
};

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
const after = JSON.parse(readFileSync(path, "utf8"));
console.log("issues:", after.issues.length);
console.log("REL-005:", after.issues.find((i) => i.id === "REL-005").status);
console.log("production_readiness ceiling:", after.production_readiness.ceiling.level, "| unreachable:", after.production_readiness.unreachable_levels.join(","));
