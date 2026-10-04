/**
 * Stage 4B: Compatibility Governance Write
 *
 * Writes 33 evidence-backed compatibility rows through the auto-confirm
 * governance path, plus product review/discovery updates for the 3 heat
 * detectors. All mutations use the official governance modules.
 *
 * Usage: node scripts/stage4b-compatibility-governance-write.mjs
 */

import { evaluateCompatibilityAutoConfirmation, autoConfirmCompatibility, COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION, COMPATIBILITY_AUTO_CONFIRM_ACTOR, EVIDENCE_CLASSIFICATION } from "../worker/compatibility-auto-confirm.mjs";
import { autoReviewProduct, autoApproveDiscovery, PRODUCT_AUTO_REVIEW_POLICY_VERSION, PRODUCT_AUTO_REVIEW_ACTOR } from "../worker/product-auto-review.mjs";

const DB_PATH = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";

// ─── Product IDs (verified from D1) ───
const HEAT = {
  "IDP-HEAT-IV":     "product_abe27b67-13ad-4051-b80b-9af0c06059d8",
  "IDP-HEAT-ROR-IV": "product_161c27bf-70d9-4e3e-b1c9-ad7783dc3dac",
  "IDP-HEAT-HT-IV":  "product_c03f06ea-1102-4c61-b73b-e8f4b4ac9698",
};

const BASE = {
  "B501-IV":      "product_08e37eac-654e-4395-a4a7-de3fd48b2054",
  "B501-WHITE":   "product_b81e9a6e-b22b-483d-9dd6-3e879f43acfd",
  "B501-BL":      "product_5b37bf5c-571e-41d3-b9df-5d0358f5000c",
  "B300-6":       "product_8d37b41e-1345-4380-bbff-5626117b7eda",
  "B200S-IV":     "product_e16abf09-c500-46dd-a6cf-3d439d8e8855",
  "B200S-WH":     "product_adc62bf9-f99f-477a-b467-c5eb855f7e2c",
  "B200S-LF-IV":  "product_02b7c285-ce7a-42e5-b182-cc6f0ae0dbc3",
  "B224BI-IV":    "product_81e00bf5-99cb-401a-be5a-bdbec3525036",
  "B224RB-IV":    "product_1f9a6ac3-412e-494f-be08-2a4eeccf0e2f",
};

const FACP = {
  "IFP-75":       "product_d21d8928-74d4-4f40-8681-ab4e99c4c843",
  "IFP-75HV":     "product_71762864-1778-4cc3-8213-7e09d4e83c90",
  "IFP-2100HV":   "product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7",
  "IFP-2100ECSHV":"product_f5078957-ab06-4202-8853-99420b50d1eb",
  "RFP-2100HV":   "product_ee62fdee-04c7-491c-a069-9199e007b5a3",
};

// ─── Source document (Honeywell Doc 350285 Rev H) ───
const SOURCE = {
  number: "350285",
  revision: "Rev H",
  date: "2017-12-01",
  url: "https://prod-edam.honeywell.com/content/dam/hon-edam/sps/common/doc/350285-en.pdf",
};

// ─── 33 compatibility relationships ───
// 27 base + 6 FACP × 3 heat detectors
const RELATIONSHIPS = [];

// Base compatibility: 3 heat detectors × 9 bases = 27 rows
const BASE_EVIDENCE = {
  "B501-IV": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "B501-WHITE": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "B501-BL": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "B300-6": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "B200S-IV": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "B200S-WH": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "B200S-LF-IV": EVIDENCE_CLASSIFICATION.SUPPORTED_VARIANT,
  "B224BI-IV": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "B224RB-IV": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
};

for (const [heatPN, heatID] of Object.entries(HEAT)) {
  for (const [basePN, baseID] of Object.entries(BASE)) {
    RELATIONSHIPS.push({
      sourceProductId: heatID,
      targetProductId: baseID,
      relationshipType: "COMPATIBLE_WITH_BASE",
      conditionsJson: JSON.stringify({ series: heatPN.split("-").slice(0, 3).join("-"), addressing: "Addressable" }),
      evidenceClassification: BASE_EVIDENCE[basePN],
      sourceDocumentNumber: SOURCE.number,
      sourceDocumentRevision: SOURCE.revision,
      sourceDocumentDate: SOURCE.date,
      sourceDocumentUrl: SOURCE.url,
      sourceDocumentPage: "1",
      sourceDocumentSection: "Compatible Bases",
      confidence: 95,
    });
  }
}

// FACP compatibility: 3 heat detectors × 5 FACPs = 6 rows (only IFP-75 series as documented)
// IFP-2100HV/IFP-2100ECSHV/RFP-2100HV are NOT in the Honeywell IDP-HEAT datasheet
const FACP_VALID = {
  "IFP-75": EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  "IFP-75HV": EVIDENCE_CLASSIFICATION.SUPPORTED_VARIANT,
};

// Actually, only IFP-75 and IFP-75HV have documented compatibility with IDP-HEAT series
// via the SLC loop. The IFP-2100 series are different panel families.
for (const [heatPN, heatID] of Object.entries(HEAT)) {
  for (const [facpPN, facpID] of Object.entries(FACP_VALID)) {
    RELATIONSHIPS.push({
      sourceProductId: heatID,
      targetProductId: facpID,
      relationshipType: "COMPATIBLE_WITH_FACP",
      conditionsJson: JSON.stringify({ protocol: "AdaptIQ/FlashScan", loop: "SLC" }),
      evidenceClassification: FACP_VALID[facpPN],
      sourceDocumentNumber: SOURCE.number,
      sourceDocumentRevision: SOURCE.revision,
      sourceDocumentDate: SOURCE.date,
      sourceDocumentUrl: SOURCE.url,
      sourceDocumentPage: "1",
      sourceDocumentSection: "Panel Compatibility",
      confidence: 90,
    });
  }
}

// ─── Mock DB adapter for SQLite direct access ───
// Since we're running outside Cloudflare Workers, we use better-sqlite3
// or sqlite3 CLI for actual writes. The governance modules are designed
// to work with any D1-like interface.
class SqliteDbAdapter {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async _exec(sql, params = []) {
    const { execSync } = await import("child_process");
    // Use sqlite3 CLI for direct writes
    const escapedSql = sql.replace(/'/g, "'\\''");
    const paramStr = params.map(p => {
      if (p === null) return "NULL";
      if (typeof p === "string") return `'${p.replace(/'/g, "''")}'`;
      return String(p);
    }).join(", ");

    // For INSERT statements, build the full SQL with params
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
            const cmd = `sqlite3 "${self.dbPath}" "${fullSql.replace(/"/g, '\\"')}"`;
            try {
              const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
              if (!output) return null;
              // Parse CSV output into object (sqlite3 default separator is |)
              // Actually we need JSON mode
              const jsonCmd = `sqlite3 -json "${self.dbPath}" "${fullSql.replace(/"/g, '\\"')}"`;
              const jsonOutput = execSync(jsonCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
              if (!jsonOutput) return null;
              const rows = JSON.parse(jsonOutput);
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
  console.log("  Stage 4B: Compatibility Governance Write");
  console.log("  Policy Version:", COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION);
  console.log("  System Actor:", COMPATIBILITY_AUTO_CONFIRM_ACTOR);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log();

  const db = new SqliteDbAdapter(DB_PATH);

  // ─── Pre-write state capture ───
  const { execSync } = await import("child_process");
  const preCompat = execSync(`sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM product_compatibility"`, { encoding: "utf-8" }).trim();
  const preReview = execSync(`sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM review_decisions"`, { encoding: "utf-8" }).trim();
  const preHeatReview = execSync(`sqlite3 "${DB_PATH}" "SELECT part_number, review_status, approved_for_discovery FROM library_products WHERE part_number IN ('IDP-HEAT-IV','IDP-HEAT-ROR-IV','IDP-HEAT-HT-IV')"`, { encoding: "utf-8" }).trim();

  console.log("PRE-WRITE STATE:");
  console.log(`  product_compatibility rows: ${preCompat}`);
  console.log(`  review_decisions rows: ${preReview}`);
  console.log(`  Heat detector status:\n${preHeatReview.split("\n").map(l => `    ${l}`).join("\n")}`);
  console.log();

  // ─── Phase 1: Auto-review heat detectors ───
  console.log("─── Phase 1: Product Auto-Review for Heat Detectors ───");
  let reviewResults = [];
  for (const [pn, pid] of Object.entries(HEAT)) {
    const reviewResult = await autoReviewProduct(db, pid);
    console.log(`  ${pn}: ${reviewResult.success ? "✅ REVIEWED" : `❌ ${reviewResult.reason}`}`);
    reviewResults.push({ pn, ...reviewResult });

    if (reviewResult.success) {
      const discoveryResult = await autoApproveDiscovery(db, pid);
      console.log(`  ${pn} discovery: ${discoveryResult.success ? "✅ APPROVED" : `❌ ${discoveryResult.reason}`}`);
    }
  }
  console.log();

  // ─── Phase 2: Auto-confirm compatibility relationships ───
  console.log("─── Phase 2: Compatibility Auto-Confirm (${RELATIONSHIPS.length} relationships) ───");
  let successCount = 0;
  let failCount = 0;
  const failures = [];

  for (let i = 0; i < RELATIONSHIPS.length; i++) {
    const rel = RELATIONSHIPS[i];
    const targetPN = Object.entries({ ...BASE, ...FACP }).find(([_, id]) => id === rel.targetProductId)?.[0] || "?";
    const sourcePN = Object.entries(HEAT).find(([_, id]) => id === rel.sourceProductId)?.[0] || "?";

    try {
      const result = await autoConfirmCompatibility(db, rel);
      if (result.success) {
        successCount++;
        console.log(`  [${i + 1}/${RELATIONSHIPS.length}] ✅ ${sourcePN} → ${targetPN} (${rel.relationshipType})`);
      } else {
        failCount++;
        failures.push({ sourcePN, targetPN, reason: result.reason });
        console.log(`  [${i + 1}/${RELATIONSHIPS.length}] ❌ ${sourcePN} → ${targetPN}: ${result.reason}`);
      }
    } catch (err) {
      failCount++;
      failures.push({ sourcePN, targetPN, reason: err.message });
      console.log(`  [${i + 1}/${RELATIONSHIPS.length}] ⚠️  ${sourcePN} → ${targetPN}: ${err.message}`);
    }
  }
  console.log();

  // ─── Post-write state capture ───
  const postCompat = execSync(`sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM product_compatibility"`, { encoding: "utf-8" }).trim();
  const postReview = execSync(`sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM review_decisions"`, { encoding: "utf-8" }).trim();
  const postHeatReview = execSync(`sqlite3 "${DB_PATH}" "SELECT part_number, review_status, approved_for_discovery FROM library_products WHERE part_number IN ('IDP-HEAT-IV','IDP-HEAT-ROR-IV','IDP-HEAT-HT-IV')"`, { encoding: "utf-8" }).trim();

  console.log("POST-WRITE STATE:");
  console.log(`  product_compatibility rows: ${preCompat} → ${postCompat}`);
  console.log(`  review_decisions rows: ${preReview} → ${postReview}`);
  console.log(`  Heat detector status:\n${postHeatReview.split("\n").map(l => `    ${l}`).join("\n")}`);
  console.log();

  // ─── Summary ───
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Relationships attempted: ${RELATIONSHIPS.length}`);
  console.log(`  ✅ Successes: ${successCount}`);
  console.log(`  ❌ Failures: ${failCount}`);
  if (failures.length > 0) {
    console.log(`\n  Failure details:`);
    for (const f of failures) {
      console.log(`    - ${f.sourcePN} → ${f.targetPN}: ${f.reason}`);
    }
  }
  console.log();
  console.log(`  Reviews completed: ${reviewResults.filter(r => r.success).length}/${reviewResults.length}`);
  console.log(`  Policy: ${COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION}`);
  console.log(`  Actor: ${COMPATIBILITY_AUTO_CONFIRM_ACTOR}`);
  console.log("═══════════════════════════════════════════════════════════════");

  // Exit code indicates success/failure
  process.exit(failCount > 0 || reviewResults.some(r => !r.success) ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(2);
});
