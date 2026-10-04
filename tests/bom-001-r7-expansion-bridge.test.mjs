// BOM-001: the R7 -> BOM bridge gap.
//
// Regression guard for the governed fail-closed gate that stops a Fire Alarm
// quotation reaching `ready: true` while the R7 capacity calculation has proven
// a required expansion hardware quantity that no BOM line carries.
//
// The unit under test is the REAL production module. No global shims, no
// injected globals, no hand-written substitute for projectPanelSizingBlockers.
import test from "node:test";
import assert from "node:assert/strict";

import { projectPanelSizingBlockers } from "../worker/quotation-line-authority.mjs";

// Minimal read-only D1 double. Every statement the gate can issue is served
// here; anything else throws so an unhandled query cannot pass silently.
const sizingDb = ({ systemDomain = "Fire Alarm", snapshots = [] } = {}) => {
  const calls = { first: [], all: [], run: 0, batch: 0 };
  return {
    calls,
    exec: () => {},
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.first.push({ sql, args });
              if (sql.includes("FROM projects")) {
                return { id: args[0], system_domain: systemDomain };
              }
              if (sql.includes("FROM fire_alarm_panel_sizing_snapshots")) {
                return snapshots[0] || null;
              }
              throw new Error(`Unexpected .first() query: ${sql}`);
            },
            async all() {
              calls.all.push({ sql, args });
              return { results: [] };
            },
            async run() {
              calls.run += 1;
              throw new Error("The panel-sizing blocker gate must never write.");
            },
          };
        },
      };
    },
    async batch() {
      calls.batch += 1;
      throw new Error("The panel-sizing blocker gate must never batch.");
    },
  };
};

const governedCalculation = (requiredExpansionQuantity) =>
  JSON.stringify({
    engineVersion: "fire-alarm-panel-sizing-engine-v1",
    sizing: {
      status: "AUTHORITATIVE_PANEL_SIZING",
      panels: [],
      projectTotal: {
        requiredExpansionQuantity,
        mountingUnitQuantity: 0,
        anyInsufficientEvidence: false,
        anyCapacityExceeded: false,
        anyConflict: false,
      },
      unallocatedDemand: null,
    },
    panels: [],
  });

const snapshot = ({ version = 1, status = "COMPLETED", calculation = governedCalculation(0) } = {}) => ({
  id: `ps${version}`,
  version_number: version,
  status,
  input_fingerprint: "panel-input-fp",
  calculation_json: calculation,
});

// A) Fail-closed path: a proven expansion requirement MUST block.
test("BOM-001 a COMPLETED snapshot proving required expansion hardware blocks the quotation", async () => {
  const db = sizingDb({ snapshots: [snapshot({ calculation: governedCalculation(2) })] });
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), ["PANEL_SIZING_EXPANSION_REQUIRED"]);
});

// B) Positive path: zero required expansion clears the gate.
test("BOM-001 a COMPLETED snapshot proving no required expansion clears the gate", async () => {
  const db = sizingDb({ snapshots: [snapshot({ calculation: governedCalculation(0) })] });
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), []);
});

// C) Fail-closed path: an unreadable calculation must NOT read as "no requirement".
test("BOM-001 an unreadable COMPLETED calculation fails closed rather than passing", async () => {
  for (const [label, calculation] of [
    ["empty object", "{}"],
    ["malformed json", "{not json"],
    ["null", null],
    ["missing sizing", JSON.stringify({ engineVersion: "v1", panels: [] })],
    ["non-numeric requirement", governedCalculation("not-a-number")],
  ]) {
    const db = sizingDb({ snapshots: [snapshot({ calculation })] });
    assert.deepEqual(
      await projectPanelSizingBlockers(db, "p1"),
      ["PANEL_SIZING_EVIDENCE_UNREADABLE"],
      `${label} must fail closed`,
    );
  }
});

// D) Currentness / supersession: only the HIGHEST version_number is read, so a
//    later governing snapshot clears a blocker raised by an earlier one. This is
//    what makes the gate resolvable rather than a permanent dead end.
test("BOM-001 the gate reads the highest snapshot version, so re-sizing resolves the blocker", async () => {
  const db = sizingDb({
    snapshots: [snapshot({ version: 1, calculation: governedCalculation(3) })],
  });
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), ["PANEL_SIZING_EXPANSION_REQUIRED"]);

  const resized = sizingDb({ snapshots: [snapshot({ version: 2, calculation: governedCalculation(0) })] });
  assert.deepEqual(await projectPanelSizingBlockers(resized, "p1"), []);
});

// E) Stale path: pre-existing gate semantics are preserved and take precedence.
test("BOM-001 absence and non-COMPLETED status keep their existing blocker codes", async () => {
  assert.deepEqual(await projectPanelSizingBlockers(sizingDb({ snapshots: [] }), "p1"), [
    "PANEL_SIZING_SNAPSHOT_REQUIRED",
  ]);
  assert.deepEqual(
    await projectPanelSizingBlockers(
      sizingDb({ snapshots: [snapshot({ status: "STALE", calculation: governedCalculation(0) })] }),
      "p1",
    ),
    ["PANEL_SIZING_EVIDENCE_STALE"],
  );
  // A stale snapshot must be reported as stale even when it proves a deficit:
  // staleness is the more fundamental defect and keeps its own code.
  assert.deepEqual(
    await projectPanelSizingBlockers(
      sizingDb({ snapshots: [snapshot({ status: "STALE", calculation: governedCalculation(5) })] }),
      "p1",
    ),
    ["PANEL_SIZING_EVIDENCE_STALE"],
  );
});

// F) Domain isolation: the gate stays Fire Alarm scoped, exactly as before.
test("BOM-001 a non-Fire-Alarm project never carries a panel-sizing blocker", async () => {
  for (const systemDomain of ["CCTV", "Data & Structured Cabling", "Unspecified", ""]) {
    const db = sizingDb({ systemDomain, snapshots: [snapshot({ calculation: governedCalculation(9) })] });
    assert.deepEqual(
      await projectPanelSizingBlockers(db, "p1"),
      [],
      `${JSON.stringify(systemDomain)} must not block on panel sizing`,
    );
  }
});

// G) Idempotency: the gate is a pure read and returns a stable verdict.
test("BOM-001 the gate is read-only and stable across repeated evaluation", async () => {
  const db = sizingDb({ snapshots: [snapshot({ calculation: governedCalculation(4) })] });
  const first = await projectPanelSizingBlockers(db, "p1");
  const second = await projectPanelSizingBlockers(db, "p1");
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["PANEL_SIZING_EXPANSION_REQUIRED"]);
  assert.equal(db.calls.run, 0, "the gate must not write");
  assert.equal(db.calls.batch, 0, "the gate must not batch");
});
