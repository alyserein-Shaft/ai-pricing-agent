#!/usr/bin/env node
/**
 * Stage 3E — Knowledge Product Identity Repair: Golden real-SQLite verification.
 *
 * Applies the full Drizzle migration set to a fresh local D1 state directory
 * (Miniflare = real SQLite) through wrangler, opens the resulting D1 SQLite
 * file with node:sqlite, seeds the frozen golden Observability fact / NPC link
 * / canonical Active product / manufacturer, then exercises
 * repairKnowledgeProductLink twice against REAL SQLite:
 *
 *   1st repair -> REPAIRED,       auditWritten: true,  one link mutation + one event
 *   2nd repair -> ALREADY_LINKED, zero writes,         no additional event
 *
 * The audit's causality guard — (SELECT changes()) = 1 immediately after the
 * guarded UPDATE inside ONE db.batch() — runs against genuine SQLite semantics
 * here, proving D1 compatibility end to end. A direct raw-SQL pair also proves
 * that a zero-row UPDATE yields changes()=0 and concedes the audit insert.
 *
 * Identity-only boundary: only the link row + one audit event are written; no
 * product, fact, price, conflict, discovery, certification, or supersession
 * state is touched; no engineer review task is created.
 *
 * Usage:
 *   node scripts/stage3e-knowledge-identity-repair-golden.mjs
 *   node scripts/stage3e-knowledge-identity-repair-golden.mjs --db /path/to/d1.sqlite
 *       (run directly against an already-migrated D1 SQLite file; skips wrangler)
 *   node scripts/stage3e-knowledge-identity-repair-golden.mjs --state-dir /existing/dir
 *       (reuse a pre-migrated state dir; skips wrangler)
 *
 * Exit code 0 = pass. Exit code 1 = fail (fails closed on any missing artifact).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  repairKnowledgeProductLink,
  IDENTITY_REPAIR_LINK_STATE,
  IDENTITY_REPAIR_AUDIT_TYPE,
} from "../worker/knowledge-product-repair.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN_CONFIG = "tests/e2e/wrangler.golden.jsonc";
const DB_NAME = "site-creator-d1";

// Frozen Golden identifiers (identical to tests/knowledge-product-repair.test.mjs).
const ORG = "organization_bd_shaft_internal_pilot";
const FACT_ID = "knowledgeFact_6dbbd08f-4e40-48b5-8601-e644b2b2c556";
const LINK_ID = "knowledgeLink_a2bc1e97-9287-497e-934b-1d9c2ba83b39";
const CANONICAL = "product_0c4c8db3-674b-4564-8249-463c00885317";
const FACT_FILE_ID = "knowledgeFile_stage3e-golden";
const MANUFACTURER_ID = "manufacturer_honeywell";

const outcomes = [];
const record = (ok, message) => {
  outcomes.push({ ok, message });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${message}\n`);
};

// ---------------------------------------------------------------------------
// Fresh golden D1 state directory (mirrors scripts/setup-golden-e2e.sh).
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let dbPath = flag("--db");
let stateDir = flag("--state-dir");
const ownsStateDir = !stateDir && !dbPath;

if (dbPath) {
  record(existsSync(dbPath), `using provided D1 SQLite file: ${dbPath}`);
} else {
  stateDir = stateDir || mkdtempSync(join(tmpdir(), "stage3e-golden-d1."));
  const wrangler = join(projectRoot, "node_modules/wrangler/bin/wrangler.js");
  record(existsSync(wrangler), `wrangler present: ${wrangler}`);
  const command = [wrangler, "d1", "migrations", "apply", DB_NAME, "--local", "--persist-to", stateDir, "--config", GOLDEN_CONFIG];
  process.stdout.write(`> node ${command.join(" ")}\n`);
  execFileSync(process.execPath, command, {
    cwd: projectRoot,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", MINIFLARE_REGISTRY_PATH: join(stateDir, "registry"), WRANGLER_LOG_PATH: join(stateDir, "wrangler.log") },
    stdio: "inherit",
  });
  // Resolve by canonical database IDENTITY instead of "exactly one sqlite found".
  // The state directory also contains backup copies sharing the canonical id, so
  // this assertion was itself a stale-read hazard, not a safety check.
  const { resolveCanonicalD1 } = await import("./lib/canonical-d1.mjs");
  dbPath = resolveCanonicalD1({ override: process.env.CANONICAL_D1_PATH });
}
record(existsSync(dbPath), `D1 SQLite file present: ${dbPath}`);

// ---------------------------------------------------------------------------
// Seed the golden rows (PRAGMA-driven: only provided + required columns).
// ---------------------------------------------------------------------------
const dbSync = new DatabaseSync(dbPath);
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const seedRow = (table, values) => {
  const meta = dbSync.prepare(`PRAGMA table_info(${table})`).all();
  const include = [];
  const args = [];
  for (const col of meta) {
    let v = values[col.name];
    if (v === undefined) {
      if (col.notnull === 0 || col.dflt_value != null || col.pk === 1) continue; // omit: defaulted/nullable
      // NOT NULL without a default: schema-drift-safe placeholder.
      if (/created_at|updated_at|processed_at|uploaded_at|deleted_at|superseded_at/.test(col.name)) v = stamp();
      else if (/status$/.test(col.name)) v = "Learned";
      else if (/confidence|byte_size|version$/.test(col.name)) v = 0;
      else if (/^id$/.test(col.name)) v = `seed_${table}`;
      else v = `seed_${table}_${col.name}`;
    }
    include.push(col.name);
    args.push(v);
  }
  dbSync.prepare(`INSERT INTO ${table} (${include.join(", ")}) VALUES (${include.map(() => "?").join(", ")})`).run(...args);
};

seedRow("product_manufacturers", {
  id: MANUFACTURER_ID,
  name: "Honeywell",
  normalized_name: "HONEYWELL",
  status: "Active",
  created_by: "system:stage3e-golden",
});
seedRow("library_products", {
  id: CANONICAL,
  manufacturer_id: MANUFACTURER_ID,
  part_number: "IDP-PHOTO-IV",
  normalized_part_number: "IDP-PHOTO-IV",
  description: "Photoelectric smoke detector",
  attributes: JSON.stringify([{ name: "protocol", value: "FlashScan" }]),
  library_scope: "Global Library",
  identity_status: "Active",
  review_status: "Learned",
  approved_for_discovery: 0,
  created_by: "system:stage3e-golden",
});
seedRow("knowledge_files", {
  id: FACT_FILE_ID,
  organization_id: ORG,
  file_name: "golden-stage3e.pdf",
  extension: "pdf",
  mime_type: "application/pdf",
  byte_size: 1024,
  sha256: "a".repeat(64),
  object_key: "golden/golden-stage3e.pdf",
  detected_type: "Specification",
  classification_confidence: 90,
  classification_status: "Classified",
  processing_status: "Processed",
  extraction_version: "1",
  uploaded_by: "system:stage3e-golden",
});
seedRow("knowledge_facts", {
  id: FACT_ID,
  organization_id: ORG,
  knowledge_file_id: FACT_FILE_ID,
  fact_type: "Part Number",
  fact_key: "IDP-PHOTO-IV",
  original_value: "IDP-PHOTO-IV",
  normalized_value: "idp-photo-iv",
  attributes: "{}",
  confidence: 90,
  review_status: "Learned",
});
seedRow("knowledge_product_links", {
  id: LINK_ID,
  organization_id: ORG,
  knowledge_fact_id: FACT_ID,
  part_number: "IDP-PHOTO-IV",
  existing_product_id: null,
  link_state: "New Product Candidate",
  new_information: JSON.stringify({ originalField: "preserved" }),
});
record(true, `seeded golden rows (org=${ORG}, fact=${FACT_ID}, link=${LINK_ID}, canonical=${CANONICAL})`);

// ---------------------------------------------------------------------------
// Minimal D1-shape adapter over the real SQLite connection: prepare/bind/
// first/all/run + transactional batch (D1 batches are atomic transactions).
// The repair's (SELECT changes()) guard is executed by REAL SQLite.
// ---------------------------------------------------------------------------
const execOnce = (sql, bindArgs, mode) => {
  const stmt = dbSync.prepare(sql);
  try {
    if (mode === "first") {
      const row = stmt.get(...bindArgs);
      return row == null ? null : { ...row };
    }
    if (mode === "all") {
      const rows = stmt.all(...bindArgs);
      return { results: rows.map((row) => ({ ...row })) };
    }
    const info = stmt.run(...bindArgs);
    return { meta: { changes: Number(info.changes || 0) } };
  } finally {
    stmt.close();
  }
};

const d1 = {
  prepare(sql) {
    return {
      bind(...bindArgs) {
        return {
          first: () => execOnce(sql, bindArgs, "first"),
          all: () => execOnce(sql, bindArgs, "all"),
          run: () => execOnce(sql, bindArgs, "run"),
          _batchExec: () => execOnce(sql, bindArgs, "run"),
        };
      },
    };
  },
  async batch(statements) {
    dbSync.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement._batchExec());
      dbSync.exec("COMMIT");
      return results;
    } catch (error) {
      try { dbSync.exec("ROLLBACK"); } catch { /* already aborted */ }
      throw error;
    }
  },
};

// ---------------------------------------------------------------------------
// First repair — REPAIRED, auditWritten true, one mutation + one event.
// ---------------------------------------------------------------------------
const first = await repairKnowledgeProductLink(d1, {
  factId: FACT_ID,
  organizationId: ORG,
  expectedLinkId: LINK_ID,
  expectedTarget: CANONICAL,
  actor: { id: "system:stage3e-golden", role: "Administrator", context: "golden-d1-verification" },
});
record(first.ok === true && first.outcome === "REPAIRED", `first repair outcome=${first.outcome}`);
record(first.target === CANONICAL, `first repair target=${first.target}`);
record(first.auditWritten === true, "first repair auditWritten=true (SQLite changes() gate honored)");
record(first.writes.linkWrites === 1 && first.writes.auditWrites === 1, `first repair writes={link ${first.writes.linkWrites}, audit ${first.writes.auditWrites}}`);

// ---------------------------------------------------------------------------
// Second repair — ALREADY_LINKED, zero writes, no additional event.
// ---------------------------------------------------------------------------
const second = await repairKnowledgeProductLink(d1, {
  factId: FACT_ID,
  organizationId: ORG,
  expectedLinkId: LINK_ID,
  expectedTarget: CANONICAL,
  actor: { id: "system:stage3e-golden", role: "Administrator", context: "golden-d1-verification" },
});
record(second.ok === true && second.outcome === "ALREADY_LINKED", `second repair outcome=${second.outcome}`);
record(second.writes.linkWrites === 0 && second.writes.auditWrites === 0, "second repair is a zero-write no-op");

// ---------------------------------------------------------------------------
// Direct raw-SQLite proof of the causality guard: a zero-row UPDATE yields
// changes()=0 and the changes()-gated audit insert concedes zero rows — even
// though EXISTS would see the first repair's committed target.
// ---------------------------------------------------------------------------
dbSync.exec("BEGIN IMMEDIATE");
try {
  const noop = dbSync.prepare(
    "UPDATE knowledge_product_links SET link_state=? WHERE id=? AND existing_product_id IS NULL",
  ).run(IDENTITY_REPAIR_LINK_STATE, LINK_ID);
  const changesAfterNoop = Number(dbSync.prepare("SELECT changes() AS c").get().c);
  record(Number(noop.changes) === 0, "raw SQLite: guarded UPDATE on repaired row changed 0 rows");
  record(changesAfterNoop === 0, "raw SQLite: changes()=0 immediately after the zero-row UPDATE");
  const conceded = dbSync.prepare(
    `INSERT INTO knowledge_file_events (id, organization_id, knowledge_file_id, event_type, details, actor_user_id)
     SELECT ?,?,?,?,?,?
     WHERE (SELECT changes()) = 1
       AND EXISTS (SELECT 1 FROM knowledge_product_links WHERE id=? AND organization_id=? AND existing_product_id=?)`,
  ).run("knowledgeEvent_stage3e-golden-noop", ORG, FACT_FILE_ID, IDENTITY_REPAIR_AUDIT_TYPE, "{}", "system:stage3e-golden", LINK_ID, ORG, CANONICAL);
  record(Number(conceded.changes) === 0, "raw SQLite: changes()-gated audit INSERT concedes 0 rows for the zero-row loser (EXISTS alone would pass)");
} finally {
  dbSync.exec("ROLLBACK");
}

// ---------------------------------------------------------------------------
// Persisted state: link row + exactly one identity audit event; nothing else.
// ---------------------------------------------------------------------------
const link = dbSync.prepare("SELECT * FROM knowledge_product_links WHERE id=?").get(LINK_ID);
record(link.existing_product_id === CANONICAL, "link row carries the canonical target");
record(link.link_state === IDENTITY_REPAIR_LINK_STATE, `link state = "${IDENTITY_REPAIR_LINK_STATE}"`);
record(link.part_number === "IDP-PHOTO-IV", "original observed/source part number never erased");
const linkInfo = JSON.parse(link.new_information);
record(linkInfo.identityRepair?.identityDecisionOnly === true, "link provenance identityDecisionOnly=true");
record(linkInfo.identityRepair?.technicalSuitabilityEvaluated === false, "link provenance technicalSuitabilityEvaluated=false");
record(linkInfo.identityRepair?.originalPartNumber === "IDP-PHOTO-IV", "link provenance preserves original part number");
record(linkInfo.originalField === "preserved", "prior link content preserved");

const events = dbSync.prepare("SELECT * FROM knowledge_file_events WHERE event_type=?").all(IDENTITY_REPAIR_AUDIT_TYPE);
record(events.length === 1, `exactly one audit event (found ${events.length})`);
const details = JSON.parse(events[0].details);
record(details.safety?.technicalEvaluation === "NOT_PERFORMED", "audit safety.technicalEvaluation=NOT_PERFORMED");
record(details.safety?.approvedForDiscovery === false, "audit safety.approvedForDiscovery=false");
record(details.safety?.costingEligible === false, "audit safety.costingEligible=false");
record(details.originalPartNumber === "IDP-PHOTO-IV", "audit preserves the original observed part number");
record(String(events[0].actor_user_id).startsWith("system:") || events[0].actor_user_id === "system:stage3e-golden", `audit actor=${events[0].actor_user_id}`);

const fact = dbSync.prepare("SELECT * FROM knowledge_facts WHERE id=?").get(FACT_ID);
record(fact.original_value === "IDP-PHOTO-IV", "knowledge fact untouched: original value preserved");

// ---------------------------------------------------------------------------
// Result.
// ---------------------------------------------------------------------------
const failures = outcomes.filter((o) => !o.ok).length;
process.stdout.write(`\nStage 3E golden / real-D1 verification: ${outcomes.length - failures}/${outcomes.length} checks passed\n`);
if (failures > 0) {
  process.stdout.write("GOLDEN_D1 = FAIL\n");
  try { dbSync.close(); } catch { /* closed */ }
  process.exitCode = 1;
} else {
  process.stdout.write("GOLDEN_D1 = PASS\n");
  dbSync.close();
  // A self-created scratch state dir is removed on success only; a failure
  // (or a user-provided --state-dir/--db) keeps it for inspection.
  if (ownsStateDir) rmSync(stateDir, { recursive: true, force: true });
}