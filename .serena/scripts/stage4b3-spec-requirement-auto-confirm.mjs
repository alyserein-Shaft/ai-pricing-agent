/**
 * Stage 4B-3: Specification Requirement System Auto-Confirm
 *
 * Runs dry-run across the full active extraction to identify eligible requirements,
 * then applies auto-confirmation through the official governed path.
 */

import { evaluateSpecRequirementAutoConfirmation, autoConfirmSpecRequirement, findEligibleSpecRequirements, batchAutoConfirmSpecRequirements, SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION, SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR } from "../worker/spec-requirement-auto-confirm.mjs";

const DB_PATH = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const PROJECT_ID = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";

// ─── Mock DB adapter for SQLite direct access ───
class SqliteDbAdapter {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async _exec(sql, params = []) {
    const { execSync } = await import("child_process");
    const fullSql = this._buildSql(sql, params);
    const cmd = `sqlite3 "${this.dbPath}" "${fullSql.replace(/"/g, '\\"')}"`;
    try {
      execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return {};
    } catch (err) {
      console.error(`SQL Error: ${err.message}`);
      throw err;
    }
  }

  _buildSql(sql, params) {
    let idx = 0;
    return sql.replace(/\?/g, () => {
      const val = params[idx++];
      if (val === null || val === undefined) return "NULL";
      if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
      if (typeof val === "number") return String(val);
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }

  prepare(sql) {
    const self = this;
    return {
      bind(...args) {
        return {
          async first() {
            const { execSync } = await import("child_process");
            const fullSql = self._buildSql(sql, args);
            const jsonCmd = `sqlite3 -json "${self.dbPath}" "${fullSql.replace(/"/g, '\\"')}"`;
            try {
              const output = execSync(jsonCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
              if (!output) return null;
              const rows = JSON.parse(output);
              return rows.length > 0 ? rows[0] : null;
            } catch { return null; }
          },
          async all() {
            const { execSync } = await import("child_process");
            const fullSql = self._buildSql(sql, args);
            const jsonCmd = `sqlite3 -json "${self.dbPath}" "${fullSql.replace(/"/g, '\\"')}"`;
            try {
              const output = execSync(jsonCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
              if (!output) return { results: [] };
              const rows = JSON.parse(output);
              return { results: rows };
            } catch { return { results: [] }; }
          },
          async run() {
            await self._exec(sql, args);
            return {};
          }
        };
      }
    };
  }

  async batch(statements) {
    for (const stmt of statements) {
      await stmt.run();
    }
    return {};
  }
}

// ─── Main execution ───
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Stage 4B-3: Specification Requirement System Auto-Confirm");
  console.log("  Policy Version:", SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION);
  console.log("  System Actor:", SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log();

  const db = new SqliteDbAdapter(DB_PATH);

  // ─── Phase 1: DRY RUN - Find all eligible requirements ───
  console.log("─── Phase 1: DRY RUN - Finding eligible requirements ───");
  const dryRunResult = await findEligibleSpecRequirements(db, PROJECT_ID);
  console.log(`Active extraction version: ${dryRunResult.activeExtractionVersionId}`);
  console.log(`Total pending requirements: ${dryRunResult.total}`);
  console.log(`Eligible for auto-confirm: ${dryRunResult.eligible.length}`);
  console.log();

  // Print detailed evaluation for each requirement
  console.log("Detailed evaluation:");
  for (const ev of dryRunResult.evaluations) {
    const status = ev.eligible ? "✅ ELIGIBLE" : `❌ ${ev.reason}`;
    console.log(`  ${ev.requirementId}: ${status}`);
    if (!ev.eligible) {
      const failedGates = ev.gates.filter(g => !g.pass);
      for (const gate of failedGates) {
        console.log(`    Gate ${gate.gate} (${gate.name}): ${gate.reason}`);
      }
    }
  }
  console.log();

  // ─── Phase 2: Auto-confirm eligible requirements ───
  if (dryRunResult.eligible.length > 0) {
    console.log("─── Phase 2: Auto-confirming eligible requirements ───");
    const batchResult = await batchAutoConfirmSpecRequirements(db, dryRunResult.eligible, dryRunResult.activeExtractionVersionId);
    console.log(`Total: ${batchResult.total}`);
    console.log(`✅ Successes: ${batchResult.successes}`);
    console.log(`❌ Failures: ${batchResult.failures}`);
    console.log();

    if (batchResult.failures > 0) {
      console.log("Failure details:");
      for (const f of batchResult.results.filter(r => !r.success)) {
        console.log(`  - ${f.evaluation.requirement.id}: ${f.reason}`);
      }
      console.log();
    }
  } else {
    console.log("─── Phase 2: No eligible requirements to auto-confirm ───");
    console.log();
  }

  // ─── Post-state verification ───
  console.log("─── Post-state verification ───");
  const postState = await db.prepare(
    `SELECT id, original_text, review_status, approved_for_downstream
     FROM technical_requirements
     WHERE project_id = ? AND review_status = 'Approved'`
  ).bind(PROJECT_ID).all();

  console.log(`Approved requirements (auto-confirmed + manual): ${postState.results?.length || 0}`);
  if (postState.results) {
    for (const req of postState.results) {
      console.log(`  - ${req.id}: ${req.original_text.substring(0, 80)}... [Approved, downstream: ${req.approved_for_downstream}]`);
    }
  }

  console.log();
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Policy: ${SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION}`);
  console.log(`  Actor: ${SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR}`);
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(2);
});