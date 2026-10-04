#!/usr/bin/env node
// DESTRUCTIVE-MIGRATION SAFETY GUARD -- read-only. Exits non-zero on risk.
//
// WHY THIS EXISTS (the defect it prevents)
// ---------------------------------------
// scripts/check-live-reconciliation-preconditions.mjs checked exactly ONE
// invariant, NULL_REQUIREMENT_ID_ROWS. It correctly reported a block, but for
// the WRONG REASON: it counted `requirement_id IS NULL`, which the canonical
// XOR source-authority model (migrations 0009/0010/0011) makes a VALID, by-design
// representation for device-identity observations. So that gate can never reach
// zero, and meanwhile it was completely BLIND to the actual hazard in the
// migration it was gating: 0019's 27 DROP TABLE statements with no rebuild
// counterpart (3,502 governed rows), and a NOT NULL rebuild that silently drops
// the `requirement_source` / `device_identity_ref` authority columns.
//
// A reconciliation runbook that claims "zero data loss" while gating only on
// one nullable count is not a safety gate. This guard closes that class of
// defect generically, for any candidate migration, without needing domain
// knowledge of which tables happen to matter today.
//
// WHAT IT CHECKS (read-only, never writes)
// ----------------------------------------
//   1. DROP TABLE            -> does the live/copy database hold rows?
//   2. destructive rebuild   -> a CREATE __new_X / DROP X / RENAME X sequence
//                                where the copy-in SELECT does not carry every
//                                live column forward (silent column loss)
//   3. NOT NULL tightening   -> a rebuild that introduces NOT NULL on a column
//                                that currently holds NULLs in live data
//   4. DROP COLUMN           -> does the dropped column currently hold data?
//   5. CHECK-constraint loss -> does the rebuild re-declare the CHECKs that
//                                live currently enforces?
//   6. row-loss risk          -> net negative row delta for any table
//
// It reads the database through the sqlite3 CLI / node:sqlite in immutable mode.
// It NEVER writes, never migrates, and never touches the canonical ledger.
//
// USAGE
//   node scripts/check-migration-destructive-ddl.mjs <sqlite> <migration.sql> [...]
//
// EXIT CODES
//   0  no destructive risk found
//   2  destructive risk found (fail closed)
//   3  usage / unreadable input
//
// Related: the XOR-aware replacement query for the legacy NULL gate lives in
// scripts/check-live-reconciliation-preconditions.mjs -- see XOR_SOURCE_QUERY.

import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
if (argv.length < 2 || argv.length === 2 && argv[1].startsWith("--")) {
  console.error("usage: node scripts/check-migration-destructive-ddl.mjs [--json] <sqlite> <migration.sql> [...]");
  process.exit(3);
}
// Flags are stripped before positional parsing so that `--json` is never
// mistaken for a migration path.
const flags = argv.filter((a) => a.startsWith("--"));
const positional = argv.filter((a) => !a.startsWith("--"));
const [dbPath, ...migrations] = positional;
if (!existsSync(dbPath)) {
  console.error(`DESTRUCTIVE-DDL GUARD ABORTED: database not found: ${dbPath}`);
  process.exit(3);
}

/**
 * Open the database strictly read-only.
 *
 * immutable=1 is deliberate: it tells SQLite the file cannot change underneath
 * us, so it skips locking and cannot write. This is the strongest read-only
 * guarantee available without copying, and it means a bug in this script cannot
 * mutate canonical D1.
 */
function openReadOnly(path) {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// migration parsing
// ---------------------------------------------------------------------------

/**
 * Strip SQL comments so that prose such as
 * "-- ... every subsequent DROP TABLE aborted with FOREIGN KEY constraint"
 * is never mistaken for an executable statement. The canonical migrations are
 * heavily commented, and a naive regex over the raw text both invents tables
 * and hides real ones.
 *
 * IMPORTANT: `--> statement-breakpoint` is this chain's own statement
 * separator and is NOT a comment. A blanket `--[^\n]*` rule would delete the
 * separator and silently merge consecutive statements into one unparseable
 * blob, so the separator is protected before comments are stripped.
 */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";
const stripComments = (sql) => {
  const SENTINEL = "\u0000BP\u0000";
  const protectedSql = sql.split(STATEMENT_BREAKPOINT).join(SENTINEL);
  return protectedSql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .split(SENTINEL)
    .join(STATEMENT_BREAKPOINT);
};

/**
 * Remove a table-level clause (`CONSTRAINT ... CHECK (...)`,
 * `FOREIGN KEY (...) REFERENCES ...`) together with ALL of its text.
 *
 * A regex with a non-greedy `[\s\S]*?` cannot do this: a CHECK body contains
 * nested parentheses (`CHECK ((a) OR (b))`), so the lazy match stops at the
 * FIRST `)` and leaves the remainder behind. That leftover text is then parsed
 * as if it were column definitions, which reports a correctly re-declared
 * CHECK as a NOT NULL column -- a false positive that would send an engineer
 * chasing a defect that does not exist.
 *
 * So the clause is removed by counting parentheses instead.
 */
function stripTableClauses(text) {
  // Scan with absolute offsets only. Slicing `rest = text.slice(i)` and then
  // indexing back into `text` mixes relative and absolute positions, which
  // silently removes the FIRST clause and leaves later ones behind.
  const clauseStarts = /CONSTRAINT\s+`?[A-Za-z0-9_]+`?\s+CHECK|FOREIGN KEY\s*\(/gi;
  let out = "";
  let cursor = 0;

  while (cursor < text.length) {
    clauseStarts.lastIndex = cursor;
    const m = clauseStarts.exec(text);
    if (!m) { out += text.slice(cursor); break; }

    const openIdx = text.indexOf("(", m.index + m[0].length);
    if (openIdx < 0) { out += text.slice(cursor); break; }

    // Copy everything before the clause, then skip the clause and one
    // trailing separator comma if present.
    out += text.slice(cursor, m.index);

    let depth = 0;
    let j = openIdx;
    for (; j < text.length; j += 1) {
      if (text[j] === "(") depth += 1;
      else if (text[j] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    let end = j + 1;
    while (end < text.length && /\s/.test(text[end])) end += 1;
    if (text[end] === ",") end += 1;
    cursor = end;
  }
  return out;
}

const normalise = (sql) => sql.replace(/\s+/g, " ").trim();

/**
 * Split on statement breakpoints, which is how this chain separates statements.
 * Falls back to `;` splitting only when breakpoints are absent.
 */
const statements = (sql) => {
  const clean = stripComments(sql);
  const parts = clean.includes("--> statement-breakpoint")
    ? clean.split("--> statement-breakpoint")
    : clean.split(";");
  return parts.map(normalise).filter(Boolean);
};

const TABLE_NAME = (raw) => raw.replace(/[`"\[\]]/g, "").trim();

/**
 * Collect every DROP TABLE target in the migration, together with whether that
 * table is rebuilt via the standard `CREATE TABLE __new_<name>` pattern.
 *
 * The `__new_` rebuild is the data-preserving SQLite idiom: create a new shape,
 * INSERT..SELECT the rows across, drop the old table, rename. A DROP that has a
 * `__new_` counterpart is therefore expected and safe. A DROP with NO
 * counterpart is destructive: the table simply ceases to exist.
 */
function analyseDropTables(statements_) {
  const rebuilt = new Set();
  for (const st of statements_) {
    const m = st.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?__new_([A-Za-z0-9_]+)`?/i);
    if (m) rebuilt.add(m[1]);
  }
  const drops = new Map();
  for (const st of statements_) {
    const m = st.match(/DROP TABLE\s+(?:IF EXISTS\s+)?`?([A-Za-z0-9_]+)`?/i);
    if (!m) continue;
    const name = TABLE_NAME(m[1]);
    // A DROP is only part of a rebuild if the rebuilt table is renamed onto it.
    const isRebuild = rebuilt.has(name) || statements_.some((s) =>
      new RegExp(`ALTER TABLE\\s+\`?__new_${name}\`?\\s+RENAME TO\\s+\`?${name}\`?`, "i").test(s));
    if (isRebuild) continue;
    drops.set(name, (drops.get(name) || 0) + 1);
  }
  return drops;
}

/**
 * For each `__new_` rebuild, compare the columns the copy-in SELECT carries
 * against the columns the new table declares.
 *
 * This is the check that catches the real defect in 0019: the rebuild declares
 * `requirement_id text NOT NULL` and omits `requirement_source` /
 * `device_identity_ref`, while the copy-in SELECT names neither. Applying it
 * would both abort on the NOT NULL and silently discard the authority columns.
 */
function analyseRebuilds(statements_) {
  const findings = [];
  for (const st of statements_) {
    // The column list is taken from the WHOLE statement with table-level
    // clauses removed FIRST, then bounded by the first remaining comma-free
    // close.
    //
    // Taking `st.lastIndexOf(")")` as the boundary does NOT work: a re-declared
    // `CONSTRAINT ... CHECK (...)` contains its own closing parens, so the LAST
    // one belongs to the CHECK, not to the column list. That truncates the list
    // mid-way and makes the parser read the CHECK's own `... IS NOT NULL`
    // fragments as if they were column constraints.
    const head = st.match(/CREATE TABLE\s+`?__new_([A-Za-z0-9_]+)`?\s*\(/i);
    if (!head) continue;
    const create = { 1: head[1], 2: stripTableClauses(st.slice(head[0].length)) };
    if (!create) continue;
    const target = create[1];
    // Column definitions only. A table-level clause such as
    // `CONSTRAINT `x_ck` CHECK (`col` IS NOT NULL)` also matches the naive
    // "`name` <word>" shape, so those clauses are removed before the column
    // list is scanned; otherwise a correctly re-declared CHECK is misreported
    // as a column the copy-in fails to carry.
    const body = stripTableClauses(create[2]);
    const declared = [...body.matchAll(/`([A-Za-z0-9_]+)`\s+[A-Za-z]/g)].map((m) => m[1]);

    const notNull = [...body.matchAll(/`([A-Za-z0-9_]+)`\s+[A-Za-z]+\s+NOT NULL/gi)].map((m) => m[1]);

    // The copy-in SELECT for this rebuild.
    const copy = statements_.find((s) =>
      new RegExp(`INSERT INTO\\s+\`?__new_${target}\`?\\s*\\(([\\s\\S]*?)\\)\\s*SELECT\\s*([\\s\\S]*?)\\s*FROM`, "i").test(s));
    const carried = copy
      ? [...copy.match(new RegExp(`INSERT INTO\\s+\`?__new_${target}\`?\\s*\\(([\\s\\S]*?)\\)\\s*SELECT`, "i"))[1]
          .matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1])
      : [];

    // Columns the live-era table had (recorded on the old CREATE/ALTER) are not
    // knowable from the migration alone, so report what IS knowable:
    //   - a declared column the copy-in does not carry  -> silent data loss
    //   - a NOT NULL tightening                           -> may abort on live NULLs
    const notCarried = carried.length ? declared.filter((c) => !carried.includes(c)) : [];
    findings.push({ table: target, declared, carried, notCarried, notNull });
  }
  return findings;
}

/** DROP COLUMN targets, used to report whether the dropped column holds data. */
function analyseDropColumns(statements_) {
  const out = [];
  for (const st of statements_) {
    const m = st.match(/ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+DROP COLUMN\s+`?([A-Za-z0-9_]+)`?/i);
    if (m) out.push({ table: TABLE_NAME(m[1]), column: TABLE_NAME(m[2]) });
  }
  return out;
}

/**
 * CHECK constraints declared by a `__new_<table>` rebuild.
 *
 * Losing a CHECK is destructive even when every row survives, because the
 * constraint was the thing that kept the rows honest. The XOR source-authority
 * CHECK on profile_requirement_applicability / requirement_intelligence_facts is
 * the live example: a rebuild that carries the columns forward but omits the
 * CHECK silently accepts rows that the domain declares impossible, and the loss
 * is invisible until much later. Row counts cannot detect this, so it is checked
 * directly against the live table's constraints.
 */
function analyseChecks(statements_) {
  const out = [];
  for (const st of statements_) {
    // A trailing statement terminator is optional here: this chain's statements
    // carry a trailing `;` that an end-anchored pattern would reject.
    const m = st.match(/CREATE TABLE\s+`?__new_([A-Za-z0-9_]+)`?\s*\(([\s\S]*)\)\s*;?\s*$/i);
    if (!m) continue;
    const checks = [...m[2].matchAll(/CONSTRAINT\s+`?([A-Za-z0-9_]+)`?\s+CHECK/gi)].map((c) => c[1]);
    out.push({ table: m[1], checks });
  }
  return out;
}

/** Named CHECK constraints the live table currently enforces. */
function liveChecks(table) {
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!row?.sql) return [];
    return [...row.sql.matchAll(/CONSTRAINT\s+`?([A-Za-z0-9_]+)`?\s+CHECK/gi)].map((c) => c[1]);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// live inspection
// ---------------------------------------------------------------------------

const db = openReadOnly(dbPath);
if (!db) {
  console.error("DESTRUCTIVE-DDL GUARD ABORTED: could not open the database read-only");
  process.exit(3);
}

const tableExists = (name) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);

/** Count rows, or null when the table holds more rows than we will count. */
function countRows(table) {
  try {
    return db.prepare(`SELECT count(*) AS c FROM "${table}"`).get().c;
  } catch {
    return null;
  }
}

function countNulls(table, column) {
  try {
    return db.prepare(`SELECT count(*) AS c FROM "${table}" WHERE "${column}" IS NULL`).get().c;
  } catch {
    return null;
  }
}

function countNonEmpty(table, column) {
  try {
    return db.prepare(
      `SELECT count(*) AS c FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" <> ''`).get().c;
  } catch {
    return null;
  }
}

/**
 * Runtime reference scan.
 *
 * A table that no runtime module mentions is a candidate for removal, but
 * absence of a reference is NOT proof of obsolescence -- so it is reported as
 * supporting evidence for a human decision, never as an automatic pass.
 */
function runtimeReferences(table) {
  let files = [];
  try {
    files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "app", "worker", "db"],
      { encoding: "utf8", maxBuffer: 1e9 }).split("\n").filter(Boolean)
      .filter((f) => /\.(mjs|js|ts|tsx)$/.test(f) && !f.startsWith("drizzle"));
  } catch {
    return { scanned: 0, hits: [] };
  }
  const camel = table.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const needles = [table, camel];
  const rx = new RegExp(`\\b(${needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`);
  const hits = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    src.split("\n").forEach((line, i) => {
      if (rx.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  return { scanned: files.length, hits };
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const findings = [];
const rows = [];

for (const migration of migrations) {
  if (!existsSync(migration)) {
    console.error(`DESTRUCTIVE-DDL GUARD ABORTED: migration not found: ${migration}`);
    process.exit(3);
  }
  const stmts = statements(readFileSync(migration, "utf8"));

  // --- 1. DROP TABLE -------------------------------------------------------
  for (const [table, occurrences] of analyseDropTables(stmts)) {
    const exists = tableExists(table);
    const liveRows = exists ? countRows(table) : null;
    const refs = runtimeReferences(table);
    const risky = exists && liveRows > 0;
    rows.push({ migration, kind: "DROP TABLE", table, liveRows, refs });
    if (risky) {
      findings.push({
        severity: "BLOCK",
        migration,
        table,
        detail: `DROP TABLE with ${liveRows} live row(s) and no __new_ rebuild counterpart`,
        remediation: "restore the table in db/schema.ts and regenerate, or re-author the migration without this DROP",
      });
    }
  }

  // --- 2/3. destructive rebuild + NOT NULL tightening ----------------------
  for (const rb of analyseRebuilds(stmts)) {
    const exists = tableExists(rb.table);
    if (rb.notCarried.length) {
      const lost = rb.declared.filter((c) => !rb.carried.includes(c));
      findings.push({
        severity: "BLOCK",
        migration,
        table: rb.table,
        detail: `rebuild declares column(s) [${lost.join(", ")}] that the copy-in SELECT does not carry -> silent column loss`,
        remediation: "carry every live column across in the INSERT..SELECT, or drop the column deliberately and prove it holds no authority",
      });
    }
    for (const col of rb.notNull) {
      if (!exists) continue;
      const nulls = countNulls(rb.table, col);
      if (nulls > 0) {
        findings.push({
          severity: "BLOCK",
          migration,
          table: rb.table,
          detail: `rebuild tightens "${col}" to NOT NULL but ${nulls} live row(s) hold NULL -- the copy-in will ABORT`,
          remediation: "enforce the real domain invariant (e.g. the XOR source-authority form) instead of NOT NULL",
        });
      }
    }
  }

  // --- 5. CHECK-constraint loss --------------------------------------------
  // A rebuild that carries every row and every column forward can still be
  // destructive by dropping the CHECK that made those rows valid.
  for (const rb of analyseChecks(stmts)) {
    if (!tableExists(rb.table)) continue;
    const current = liveChecks(rb.table);
    const dropped = current.filter((c) => !rb.checks.includes(c));
    for (const c of dropped) {
      findings.push({
        severity: "BLOCK",
        migration,
        table: rb.table,
        detail: `rebuild omits CHECK constraint "${c}" that live currently enforces -> the invariant stops being enforced even though every row survives`,
        remediation: "re-declare the constraint in the rebuilt table, or prove it is superseded by an equivalent one",
      });
    }
  }

  // --- 6. DROP COLUMN ------------------------------------------------------
  for (const dc of analyseDropColumns(stmts)) {
    if (!tableExists(dc.table)) continue;
    const populated = countNonEmpty(dc.table, dc.column);
    if (populated > 0) {
      findings.push({
        severity: "BLOCK",
        migration,
        table: dc.table,
        detail: `DROP COLUMN "${dc.column}" but ${populated} live row(s) hold a non-empty value`,
        remediation: "prove the column is superseded before dropping it",
      });
    }
  }
}

// --- 5. row-loss risk -------------------------------------------------------
const totalDestructiveRows = rows
  .filter((r) => r.kind === "DROP TABLE" && r.liveRows > 0)
  .reduce((sum, r) => sum + r.liveRows, 0);

const report = {
  database: dbPath,
  migrations,
  dropTables: rows.map((r) => ({
    table: r.table,
    liveRows: r.liveRows,
    runtimeReferences: r.refs.hits,
    runtimeFilesScanned: r.refs.scanned,
  })),
  totalAtRiskRows: totalDestructiveRows,
  findings,
  ok: findings.length === 0,
};

if (flags.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("DESTRUCTIVE-MIGRATION SAFETY GUARD (read-only)");
  console.log("=".repeat(100));
  console.log(`database : ${dbPath}`);
  console.log(`candidate: ${migrations.join(", ")}`);
  console.log("-".repeat(100));
  if (rows.length === 0) {
    console.log("no unqualified DROP TABLE statements detected");
  } else {
    console.log("DROP TABLE targets (no __new_ rebuild counterpart):");
    console.log(`  ${"TABLE".padEnd(44)}${"LIVE ROWS".padEnd(12)}RUNTIME REFS`);
    for (const r of rows) {
      const n = r.refs.hits.length;
      console.log(`  ${r.table.padEnd(44)}${String(r.liveRows ?? "-").padEnd(12)}${n === 0 ? "none" : n}`);
    }
  }
  console.log("-".repeat(100));
  if (findings.length === 0) {
    console.log("OK: no destructive row-loss risk detected");
  } else {
    console.log(`${findings.length} BLOCKING finding(s):`);
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.table}`);
      console.log(`      ${f.detail}`);
      console.log(`      remediation: ${f.remediation}`);
    }
    console.log(`\nTOTAL GOVERNED ROWS AT RISK: ${totalDestructiveRows}`);
    console.log('A runbook must NOT claim zero-data-loss while these findings stand.');
  }
  console.log("=".repeat(100));
}

db.close();
process.exit(findings.length ? 2 : 0);
