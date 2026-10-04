// G-6 -- readiness must be derived from real schema.
//
// The defect this pins: readiness reported "ready" against a database that was
// missing the entire R1 commercial schema, and could not see a half-applied table
// rebuild at all (the local dev D1 had `pricing_lines` present but without the 0015
// source-model columns, so every pricing read threw `no such column: l.source_type`
// while readiness still passed).
//
// These tests build an isolated database by applying the REAL active migration
// chain, then remove required objects and prove readiness fails and names them.
// Nothing touches the live or shared database.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { handleProductionReadinessApi } from "../worker/production-readiness-api.mjs";
import {
  MIGRATION_VERSION,
  READINESS_REQUIRED_COLUMNS,
  READINESS_REQUIRED_COMMERCIAL_TABLES,
} from "../app/domain/production-readiness.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ACTIVE_ROOT = join(ROOT, "drizzle-active");

const activeMigrations = () => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    sql: readFileSync(join(ACTIVE_ROOT, `${entry.tag}.sql`), "utf8"),
  }));
};

// A D1-shaped shim over node:sqlite, so the real handler runs unmodified.
const d1 = (raw) => ({
  prepare(sql) {
    const run = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...run(), bind: (...args) => run(args) };
  },
  batch: async (statements) => {
    raw.exec("BEGIN");
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      raw.exec("COMMIT");
      return out;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const withFullChain = async (callback) => {
  const dir = mkdtempSync(join(tmpdir(), "readiness-schema-"));
  const raw = new DatabaseSync(join(dir, "chain.sqlite"));
  raw.exec("PRAGMA foreign_keys=ON");
  try {
    for (const migration of activeMigrations()) {
      for (const statement of migration.sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) raw.exec(trimmed);
      }
    }
    return await callback(raw);
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

// Readiness now also requires a real R1 access boundary: a deployment that cannot
// authenticate must not report ready while it can serve commercial data.
const R1_ACCESS_ENV = {
  APP_ACCESS_MODE: "single-user",
  APP_R1_ACCESS_TOKEN: "readiness-test-token",
  APP_SESSION_SECRET: "readiness-test-secret",
};

const ready = async (raw, env = R1_ACCESS_ENV) => {
  const request = new Request("https://example.test/api/health/ready");
  const result = await handleProductionReadinessApi(request, { DB: d1(raw), FILES: {}, ...env });
  return { status: result.status, body: await result.json() };
};

test("readiness passes against a database built from the complete active chain", async () => {
  await withFullChain(async (raw) => {
    const { status, body } = await ready(raw);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.status, "pass");
    assert.equal(body.dependencies.database.status, "pass");
    assert.equal(body.dependencies.database.schemaVerified, true);
    assert.deepEqual(body.dependencies.database.missingTables, []);
    assert.deepEqual(body.dependencies.database.missingColumns, []);
    assert.equal(body.declaredMigrationVersion, MIGRATION_VERSION);
    assert.equal(body.migrationVersionVerifiedBy, "schema-introspection");
    assert.equal(body.dependencies.authentication.status, "pass");
  });
});

test("readiness FAILS when the deployment cannot authenticate, even with a perfect schema", async () => {
  // The schema is complete here; only the access boundary is missing. Reporting
  // ready would mean advertising an unauthenticated commercial API as deployable.
  await withFullChain(async (raw) => {
    for (const env of [
      { APP_ACCESS_MODE: "single-user" },
      { APP_ACCESS_MODE: "single-user", APP_R1_DEV_AUTH_BYPASS: "1" },
    ]) {
      const { status, body } = await ready(raw, env);
      assert.equal(status, 503, JSON.stringify(body));
      assert.equal(body.status, "fail");
      assert.equal(body.dependencies.authentication.status, "fail");
      assert.equal(body.dependencies.database.status, "pass", "the schema itself is still fine");
    }
  });
});

test("readiness fails and names a missing required TABLE", async () => {
  await withFullChain(async (raw) => {
    // 0017's table is exactly what was absent from the local dev D1 (G-6).
    raw.exec("DROP TABLE fire_alarm_preliminary_sizing_snapshots");
    const { status, body } = await ready(raw);
    assert.equal(status, 503);
    assert.equal(body.status, "fail");
    assert.equal(body.dependencies.database.schemaVerified, false);
    assert.ok(
      body.dependencies.database.missingTables.includes("fire_alarm_preliminary_sizing_snapshots"),
      JSON.stringify(body.dependencies.database),
    );
    assert.match(body.dependencies.database.reason, /Missing required table/);
  });
});

test("readiness fails when a required COLUMN is missing from a present table", async () => {
  await withFullChain(async (raw) => {
    // Simulate the half-applied rebuild: the table exists, one authority column does
    // not. A table-only check cannot see this, which is precisely the bug.
    raw.exec("DROP INDEX IF EXISTS pricing_lines_scope_uniq");
    raw.exec("ALTER TABLE pricing_lines RENAME TO pricing_lines_kept");
    raw.exec(`CREATE TABLE pricing_lines (
      id text PRIMARY KEY NOT NULL, pricing_run_id text, project_id text,
      boq_item_id text, candidate_id text, version_number integer, status text,
      quantity real, unit text, source_currency text, project_currency text,
      total_cost_minor integer, net_selling_minor integer, final_value_minor integer,
      vat_minor integer, customer_discount_minor integer, margin_basis_points integer,
      markup_basis_points integer, approval_ready integer
    )`);
    raw.exec("DROP TABLE pricing_lines_kept");

    const { status, body } = await ready(raw);
    assert.equal(status, 503);
    assert.equal(body.status, "fail");
    assert.equal(body.dependencies.database.schemaVerified, false);
    // The table is present, so only a column check can catch this.
    assert.equal(body.dependencies.database.missingTables.includes("pricing_lines"), false);
    assert.ok(
      body.dependencies.database.missingColumns.includes("pricing_lines.source_type"),
      JSON.stringify(body.dependencies.database.missingColumns),
    );
    assert.match(body.dependencies.database.reason, /partially applied/);
  });
});

test("the required commercial tables are all declared by the active migration chain", () => {
  // Anti-rot: readiness must not name an object the chain does not create, or the
  // probe would demand something the deployment can never legitimately have.
  const chain = activeMigrations().map((m) => m.sql).join("\n");
  for (const table of READINESS_REQUIRED_COMMERCIAL_TABLES) {
    const declared = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?\`?${table}\`?\\b`, "i").test(chain);
    assert.ok(declared, `readiness requires "${table}" but no active migration creates it`);
  }
});

// Column names are declared both backticked (drizzle) and bare (baseline), and a
// table can be extended by a later ALTER. Extract the real column-definition names
// per table rather than pattern-matching a quoted name in a fixed-size window.
const declaredColumnsByTable = () => {
  const chain = activeMigrations().map((m) => m.sql).join("\n--> statement-breakpoint\n");
  const tables = new Map();
  for (const m of chain.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(/gi)) {
    let depth = 0, body = "";
    for (let i = m.index + m[0].length - 1; i < chain.length; i += 1) {
      const ch = chain[i];
      if (ch === "(") depth += 1;
      if (ch === ")") { depth -= 1; if (depth === 0) break; }
      body += ch;
    }
    const cols = tables.get(m[1]) || new Set();
    for (const line of body.split("\n")) {
      const def = /^\s*`?(\w+)`?\s+\w/.exec(line);
      if (def && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(def[1])) cols.add(def[1]);
    }
    tables.set(m[1], cols);
  }
  // ALTER TABLE `t` ADD [COLUMN] `c` -- SQLite shorthand omits the COLUMN keyword.
  for (const m of chain.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?\s+ADD(?:\s+COLUMN)?\s+`?(\w+)`?/gi)) {
    const cols = tables.get(m[1]) || new Set();
    cols.add(m[2]);
    tables.set(m[1], cols);
  }
  // A table rebuilt into a temp name and renamed still defines the final table.
  for (const m of chain.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?\s+RENAME\s+TO\s+`?(\w+)`?/gi)) {
    if (tables.has(m[1])) tables.set(m[2], new Set([...(tables.get(m[2]) || []), ...tables.get(m[1])]));
  }
  return tables;
};

test("the required columns are all declared by the active migration chain", () => {
  const tables = declaredColumnsByTable();
  for (const [table, columns] of Object.entries(READINESS_REQUIRED_COLUMNS)) {
    const declared = tables.get(table);
    assert.ok(declared, `readiness requires table "${table}" but no active migration creates it`);
    for (const column of columns) {
      assert.ok(
        declared.has(column),
        `readiness requires "${table}.${column}" but no active migration declares it`,
      );
    }
  }
});
