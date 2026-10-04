#!/usr/bin/env node
// FRESH READ-ONLY CANONICAL BASELINE.
//
// Records everything a future live authorization needs to compare against:
// SHA-256, file size, table count, key row counts, XOR counts, 0020 presence,
// integrity and FK checks.
//
// Opens the database READ-ONLY in every access path. Never writes.
// Usage: node scripts/capture-canonical-baseline.mjs <sqlite> [out.json]
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const [dbPath, outPath] = process.argv.slice(2);
if (!dbPath) { console.error("usage: node scripts/capture-canonical-baseline.mjs <sqlite> [out.json]"); process.exit(3); }

const XOR_BAD = " NOT ((requirement_source='Specification' AND requirement_id IS NOT NULL AND device_identity_ref IS NULL)"
  + " OR (requirement_source IN ('DrawingDeviceIdentity','BOQDeviceIdentity') AND requirement_id IS NULL AND device_identity_ref IS NOT NULL))";

const stat = fs.statSync(dbPath);
const sha = crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");

const db = new DatabaseSync(dbPath, { readOnly: true });
const one = (sql, ...a) => db.prepare(sql).get(...a);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);

const KEY_TABLES = ["projects", "boq_items", "documents", "document_versions", "profile_requirement_applicability",
  "requirement_intelligence_facts", "historical_boq_rows", "library_security_principals", "library_products",
  "price_records", "product_source_evidence", "pricing_lines", "review_queue_items"];
const rows = {};
for (const t of KEY_TABLES) {
  if (tables.includes(t)) rows[t] = one(`SELECT count(*) c FROM "${t}"`).c;
}

const baseline = {
  capturedAt: new Date().toISOString(),
  path: dbPath,
  sha256: sha,
  bytes: stat.size,
  mtime: stat.mtime.toISOString(),
  tableCount: tables.length,
  keyRowCounts: rows,
  xor: {
    applicability: {
      total: one("SELECT count(*) c FROM profile_requirement_applicability").c,
      deviceIdentity: one("SELECT count(*) c FROM profile_requirement_applicability WHERE requirement_id IS NULL").c,
      violations: one(`SELECT count(*) c FROM profile_requirement_applicability WHERE${XOR_BAD}`).c,
    },
    facts: {
      total: one("SELECT count(*) c FROM requirement_intelligence_facts").c,
      deviceIdentity: one("SELECT count(*) c FROM requirement_intelligence_facts WHERE requirement_id IS NULL").c,
      violations: one(`SELECT count(*) c FROM requirement_intelligence_facts WHERE${XOR_BAD}`).c,
    },
  },
  drawingQuantityClaimsPresent: tables.includes("drawing_quantity_claims"),
  specificationClausesHasCandidateMechanism: db.prepare("PRAGMA table_info(specification_clauses)").all().some((c) => c.name === "candidate_mechanism"),
};

let integrity = "unknown", fk = "unknown";
try {
  integrity = execFileSync("sqlite3", [`file:${dbPath}?mode=ro`, "PRAGMA integrity_check;"], { encoding: "utf8" }).trim().split("\n")[0];
} catch (e) { integrity = `error: ${String(e.message).slice(0, 80)}`; }
try {
  const out = execFileSync("sqlite3", [`file:${dbPath}?mode=ro`, "PRAGMA foreign_key_check;"], { encoding: "utf8" }).trim();
  fk = out === "" ? "clean" : out.slice(0, 200);
} catch (e) { fk = `error: ${String(e.message).slice(0, 80)}`; }
baseline.integrityCheck = integrity;
baseline.foreignKeyCheck = fk;

db.close();

console.log("FRESH READ-ONLY CANONICAL BASELINE");
console.log("=".repeat(92));
console.log(`  capturedAt        : ${baseline.capturedAt}`);
console.log(`  sha256            : ${baseline.sha256}`);
console.log(`  bytes             : ${baseline.bytes}`);
console.log(`  mtime             : ${baseline.mtime}`);
console.log(`  tables            : ${baseline.tableCount}`);
for (const [t, n] of Object.entries(rows)) console.log(`  rows ${t.padEnd(36)} ${n}`);
console.log(`  XOR applicability : total=${baseline.xor.applicability.total} device-identity=${baseline.xor.applicability.deviceIdentity} violations=${baseline.xor.applicability.violations}`);
console.log(`  XOR facts         : total=${baseline.xor.facts.total} device-identity=${baseline.xor.facts.deviceIdentity} violations=${baseline.xor.facts.violations}`);
console.log(`  drawing_quantity_claims present : ${baseline.drawingQuantityClaimsPresent} (expected false pre-reconciliation)`);
console.log(`  candidate_mechanism present     : ${baseline.specificationClausesHasCandidateMechanism} (expected false pre-0014)`);
console.log(`  integrity_check   : ${baseline.integrityCheck}`);
console.log(`  foreign_key_check : ${baseline.foreignKeyCheck}`);
console.log("=".repeat(92));

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(baseline, null, 1));
  console.log(`  written to ${outPath}`);
}
