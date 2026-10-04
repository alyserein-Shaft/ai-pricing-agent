/**
 * Focused tests for the delivery readiness gate.
 *
 * These prove the properties the handoff depends on, not just its output:
 *   1. it is genuinely READ-ONLY (the database file is byte-identical after a run);
 *   2. it is FAIL-CLOSED and never collapses distinct blockers into one generic
 *      NOT_READY -- every blocked gate names its own code and owning lane;
 *   3. it uses the canonical authority, so its verdict agrees with the runtime's
 *      own currentness resolver rather than with a re-implementation of it;
 *   4. it never repairs: an unquotable project stays unquotable and no row is
 *      written.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { activeChain } from "./helpers/governed-quotation-fixture.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const CHECKER = join(REPO, "scripts/delivery-readiness-gate.mjs");
const GATES = [
  "LIVE_RECONCILIATION_READY",
  "REQUIREMENT_INTELLIGENCE_READY",
  "TECHNICAL_SELECTION_READY",
  "PANEL_SIZING_READY",
  "COMMERCIAL_PRICING_READY",
  "CANONICAL_QUOTATION_READY",
  "EXPORT_READY",
];

/** A migrated copy of the schema with one project that has no commercial authority. */
const unquotableProject = async () => {
  const memory = await activeChain();
  const file = join(mkdtempSync(join(tmpdir(), "delivery-gate-")), "gate.sqlite");
  // VACUUM INTO takes a literal filename, not a bound parameter.
  memory.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  memory.close();
  const db = new DatabaseSync(file);
  const insert = (sql, ...values) => {
    const [, table, columns] = /^INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)/i.exec(sql);
    const named = columns.split(",").map((c) => c.trim()).filter(Boolean);
    const supplied = Object.fromEntries(named.map((c, i) => [c, values[i]]));
    const used = [];
    const bound = [];
    for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
      if (column.name in supplied) { used.push(`"${column.name}"`); bound.push(supplied[column.name]); }
      else if (column.notnull && column.dflt_value === null) {
        used.push(`"${column.name}"`);
        bound.push(column.type === "integer" ? 0 : "seed");
      }
    }
    db.prepare(`INSERT INTO "${table}" (${used.join(",")}) VALUES (${used.map(() => "?").join(",")})`).run(...bound);
  };
  insert("INSERT INTO organizations (id,name) VALUES (?,?)", "org1", "Org");
  insert(
    "INSERT INTO projects (id,organization_id,name,owner_user_id,currency,system_domain,operational_classification) VALUES (?,?,?,?,?,?,?)",
    "project-gate", "org1", "Gate Project", "owner1", "SAR", "Fire Alarm", "Operational",
  );
  db.close();
  return file;
};

const runGate = (file, project) => {
  try {
    const stdout = execFileSync(process.execPath, [CHECKER, file, project, "--json"], { encoding: "utf8" });
    return { exit: 0, result: JSON.parse(stdout) };
  } catch (error) {
    return { exit: error.status, result: JSON.parse(error.stdout) };
  }
};

const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

test("the checker is read-only: the database file is byte-identical after a run", async () => {
  const file = await unquotableProject();
  const before = digest(file);
  runGate(file, "project-gate");
  assert.equal(digest(file), before, "the readiness gate must not write to the database");
});

test("the checker reports every gate, and blocked gates keep distinct codes and lanes", async () => {
  const file = await unquotableProject();
  const { exit, result } = runGate(file, "project-gate");
  assert.equal(exit, 1, "an unquotable project must exit non-zero");

  const names = result.gates.map((g) => g.gate);
  for (const gate of GATES) assert.ok(names.includes(gate), `missing gate ${gate}`);
  assert.equal(result.ready, false);

  // Every blocked gate carries at least one specific blocker code and a lane.
  for (const gate of result.gates.filter((g) => g.status === "BLOCKED")) {
    assert.ok(gate.blockers.length > 0, `${gate.gate} is blocked but names no blocker`);
    assert.ok(gate.nextLane, `${gate.gate} is blocked but names no owning lane`);
    for (const blocker of gate.blockers) {
      assert.match(blocker.code, /^[A-Z][A-Z0-9_]+$/, `blocker code must be explicit: ${blocker.code}`);
      assert.ok(blocker.detail && blocker.detail.length > 10, "each blocker must explain itself");
      assert.ok(blocker.owner, "each blocker must name an owning lane");
    }
  }
  // No generic verdict anywhere in the payload.
  assert.equal(JSON.stringify(result).includes("NOT_READY"), false, "the gate model must not collapse to NOT_READY");
});

test("the gate names the commercial blockers the runtime itself reports", async () => {
  const file = await unquotableProject();
  const { result } = runGate(file, "project-gate");
  const commercial = result.gates.find((g) => g.gate === "COMMERCIAL_PRICING_READY");
  assert.equal(commercial.status, "BLOCKED");
  const codes = commercial.blockers.map((b) => b.code);
  assert.ok(codes.includes("NO_PRICING_RUN"), `expected NO_PRICING_RUN in ${codes}`);
  assert.ok(codes.includes("NO_COMMERCIAL_PRICE_APPROVAL"), `expected NO_COMMERCIAL_PRICE_APPROVAL in ${codes}`);
  // The canonical quotation-line authority's own blocker code is surfaced verbatim.
  const quotation = result.gates.find((g) => g.gate === "CANONICAL_QUOTATION_READY");
  assert.ok(
    quotation.blockers.some((b) => b.code === "QUOTATION_LINE_AUTHORITY_BLOCKED"),
    "the canonical line authority refusal must be surfaced, not re-derived",
  );
});

test("export infrastructure passes independently of the commercial blockers", async () => {
  const file = await unquotableProject();
  const { result } = runGate(file, "project-gate");
  const exportGate = result.gates.find((g) => g.gate === "EXPORT_READY");
  assert.equal(exportGate.status, "PASS", `export lane should be ready: ${JSON.stringify(exportGate.blockers)}`);
  assert.equal(exportGate.evidence.issueGateAcceptsGovernedExport, true);
  assert.ok(exportGate.evidence.clientSafeSheets.length > 0, "the client-safe sheet allowlist must be reported");
});

test("panel sizing is required and reported for a Fire Alarm project", async () => {
  const file = await unquotableProject();
  const { result } = runGate(file, "project-gate");
  const panel = result.gates.find((g) => g.gate === "PANEL_SIZING_READY");
  assert.equal(panel.evidence.required, true, "a Fire Alarm project requires panel-sizing authority");
  assert.equal(panel.evidence.currentSnapshot, null, "and none exists in this fixture");
  assert.ok(panel.blockers.some((b) => b.code.startsWith("PANEL_SIZING")));
});

test("the checker refuses to run on a missing project rather than guessing", async () => {
  const file = await unquotableProject();
  try {
    execFileSync(process.execPath, [CHECKER, file, "no-such-project"], { encoding: "utf8" });
    assert.fail("the checker must fail closed on an unknown project");
  } catch (error) {
    assert.equal(error.status, 2);
    assert.match(error.stderr, /no such project/);
  }
});