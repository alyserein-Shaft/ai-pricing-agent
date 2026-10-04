import test from "node:test";
import assert from "node:assert/strict";

import { produceProjectPreliminaryPointDemand } from "../app/domain/project-point-demand-bridge.mjs";

// PHASE F/H1/H8 -- GOVERNED POINT-DEMAND BRIDGE.
//
// H1: `aggregatePreliminaryPointDemand` had zero production callers, so the
//     sizing writer's required `dependencies.demand` could never be supplied.
// H8: the handler called the writer with `{ command }` and no `dependencies`,
//     so every POST failed PRELIMINARY_SIZING_CALCULATION_MALFORMED (422).
//
// The bridge must produce a governed result from data the pipeline already
// governs, and it must never invent demand.

const PROJECT = "project-test-bridge";

const d1For = (rows) => ({
  prepare: (sql) => {
    const op = (args = []) => ({
      first: async () => (args.length ? null : { results: rows }),
      all: async () => ({ results: rows }),
      run: async () => ({ changes: 0 }),
    });
    const bound = { ...op(), sql };
    return { ...bound, bind: (...args) => op(args) };
  },
  batch: async () => [],
});

const makeBoqItem = (id, overrides = {}) => ({
  id,
  project_id: PROJECT,
  row_type: "BOQ Item",
  item_number: id.slice(-4),
  description: "Smoke detectors (above ceiling)",
  system_value: "Fire Alarm",
  approved_for_downstream: 1,
  extraction_confidence: 95,
  review_status: "Approved",
  ...overrides,
});

const runBridge = async ({ items, profiles = {}, understanding = {}, quantity = {} }) =>
  produceProjectPreliminaryPointDemand({
    db: d1For(items),
    projectId: PROJECT,
    loadCurrentProfile: async (_db, itemId) => profiles[itemId] || null,
    loadApprovedUnderstanding: async (_db, _project, itemId) => understanding[itemId] || null,
    currentSelectedQuantity: async (_db, item) => quantity[item.id] || { value: 10, source: "BOQ", status: "VALID" },
  });

test("a classified addressable detector population yields governed KNOWN demand", async () => {
  const item = makeBoqItem("boq-det-1");
  const result = await runBridge({
    items: [item],
    // Supplied EXACTLY as production persists it: a JSON string column.
    profiles: {
      "boq-det-1": { profile: JSON.stringify({
        boqItem: {
          slcResourceClassification: {
            state: "RESOLVED_ADDRESSABLE_DETECTOR",
            family: "Addressable Smoke Detector",
            unitsPerDevice: 1,
            demandUnits: 1,
            addressability: "addressable",
            quantity: { value: 40, source: "BOQ", status: "VALID" },
            reason: "Governed addressable detector family.",
            classifierVersion: "fire-alarm-slc-resource-classifier-1.1.0",
          },
        },
      }) },
    },
    understanding: { "boq-det-1": { system: { value: "Fire Alarm" }, productFamily: { value: "Addressable Smoke Detector" }, attributes: { addressing: { value: "addressable" } } } },
    quantity: { "boq-det-1": { value: 40, source: "BOQ", status: "VALID" } },
  });

  assert.equal(result.knownPointDemand, 40, "40 addressable detectors consume 40 known points");
  assert.equal(result.unknownPointDemand, 0);
  assert.equal(result.generatedFrom.populationCount, 1);
  assert.equal(result.generatedFrom.populations[0].slcState, "RESOLVED_ADDRESSABLE_DETECTOR");
  assert.equal(result.generatedFrom.populations[0].quantity, 40, "the trace carries the governed quantity");
});

test("an UNCLASSIFIED population lands in UNKNOWN demand, never in known and never zero", async () => {
  const item = makeBoqItem("boq-unknown-1");
  const result = await runBridge({ items: [item], profiles: {}, understanding: {}, quantity: {} });

  assert.equal(result.knownPointDemand, 0, "no evidence means no known demand");
  assert.equal(result.unknownPointDemand, 10, "the quantity is not coerced to zero; it is honestly unknown");
  assert.equal(result.generatedFrom.populations[0].slcState, "UNCLASSIFIED");
  assert.notEqual(result.completeness, "COMPLETE", "an unresolved population must not report completeness");
});

test("a NULL quantity is not coerced to zero", async () => {
  const item = makeBoqItem("boq-null-qty");
  const result = await runBridge({
    items: [item],
    profiles: {},
    understanding: {},
    quantity: { "boq-null-qty": { value: null, source: null, status: "UNKNOWN" } },
  });
  assert.equal(result.generatedFrom.populations[0].quantity, null, "a null quantity is carried as null");
  assert.equal(result.knownPointDemand, 0);
});

// REGRESSION GUARD for the exact coercion class that destroyed
// technical-requirement-engine.mjs: `Number(null)`, `Number("")` and
// `Number("  ")` are all 0, and `Number(undefined)` is NaN. A naive numeric
// guard therefore turns an ABSENT quantity into a population of ZERO, which
// would let a project with no evidence look like one with no demand.
test("no absent quantity can ever become a numeric zero", async () => {
  for (const absent of [null, undefined, "", "   ", NaN, -1, "many", {}]) {
    const id = "boq-absent";
    const result = await runBridge({
      items: [makeBoqItem(id)],
      profiles: {},
      understanding: {},
      quantity: { [id]: { value: absent, source: "BOQ", status: "UNKNOWN" } },
    });
    assert.equal(
      result.generatedFrom.populations[0].quantity,
      null,
      JSON.stringify(absent) + " must stay absent, never become 0",
    );
  }
});

test("a genuine zero quantity is preserved as zero, not nulled", async () => {
  const id = "boq-zero";
  const result = await runBridge({
    items: [makeBoqItem(id)],
    profiles: {},
    understanding: {},
    quantity: { [id]: { value: 0, source: "BOQ", status: "VALID" } },
  });
  assert.equal(result.generatedFrom.populations[0].quantity, 0, "a real zero is a real governed quantity");
});

test("an unresolved SLC role does NOT become a known addressable point (producer invariant 2)", async () => {
  const item = makeBoqItem("boq-unresolved");
  const result = await runBridge({
    items: [item],
    profiles: {
      "boq-unresolved": { profile: JSON.stringify({
        boqItem: {
          slcResourceClassification: {
            state: "UNRESOLVED",
            family: "Manual Call Point",
            unitsPerDevice: null,
            demandUnits: null,
            addressability: null,
            quantity: { value: 29, source: "BOQ", status: "VALID" },
            reason: "The current detector family has no governed base-mount evidence.",
            classifierVersion: "fire-alarm-slc-resource-classifier-1.1.0",
          },
        },
      }) },
    },
    understanding: { "boq-unresolved": { system: { value: "Fire Alarm" }, productFamily: { value: "Manual Call Point" }, attributes: {} } },
    quantity: { "boq-unresolved": { value: 29, source: "BOQ", status: "VALID" } },
  });

  assert.equal(result.knownPointDemand, 0, "an UNRESOLVED classification must not become a known point");
  assert.ok(result.unknownPointDemand > 0, "it is honestly unknown, and stays visible");
  assert.equal(result.generatedFrom.populations[0].slcState, "UNRESOLVED");
});

// REGRESSION GUARD for the silent-degradation defect found against the real
// project: `requirement_profile_versions.profile` is a JSON STRING column.
// Reading it without parsing yields `profile.boqItem === undefined`, so every
// population silently reported UNCLASSIFIED and the whole project's point
// demand collapsed to "unknown" -- with no error anywhere.
test("the persisted profile JSON STRING is parsed, not read as an object", async () => {
  const classification = {
    state: "RESOLVED_ADDRESSABLE_DETECTOR",
    family: "Addressable Smoke Detector",
    unitsPerDevice: 1,
    demandUnits: 1,
    addressability: "addressable",
    quantity: { value: 12, source: "BOQ", status: "VALID" },
    reason: "Governed addressable detector family.",
    classifierVersion: "fire-alarm-slc-resource-classifier-1.1.0",
  };
  const asString = await runBridge({
    items: [makeBoqItem("boq-str")],
    // The real contract: the loader returns a DB ROW whose `profile` column
    // holds a JSON STRING.
    profiles: { "boq-str": { profile: JSON.stringify({ boqItem: { slcResourceClassification: classification } }) } },
    understanding: {},
    quantity: { "boq-str": { value: 12, source: "BOQ", status: "VALID" } },
  });
  const asParsedColumn = await runBridge({
    items: [makeBoqItem("boq-obj")],
    // A caller that already parsed the column must get the identical result.
    profiles: { "boq-obj": { profile: { boqItem: { slcResourceClassification: classification } } } },
    understanding: {},
    quantity: { "boq-obj": { value: 12, source: "BOQ", status: "VALID" } },
  });

  assert.equal(asString.knownPointDemand, 12, "a string-encoded profile column must yield the same KNOWN demand as a parsed one");
  assert.equal(asParsedColumn.knownPointDemand, 12);
  assert.equal(
    asString.generatedFrom.populations[0].slcState,
    "RESOLVED_ADDRESSABLE_DETECTOR",
    "the classification must be read, not silently UNCLASSIFIED",
  );
});

test("a MALFORMED profile is absent evidence, never partially parsed", async () => {
  const result = await runBridge({
    items: [makeBoqItem("boq-bad")],
    profiles: { "boq-bad": { profile: "{ this is not json" } },
    understanding: {},
    quantity: { "boq-bad": { value: 5, source: "BOQ", status: "VALID" } },
  });
  assert.equal(result.generatedFrom.populations[0].slcState, "UNCLASSIFIED", "a broken profile is unclassified, not a crash");
  assert.equal(result.knownPointDemand, 0, "and contributes no known demand");
});

test("a null unitsPerDevice is not coerced to zero", async () => {
  // `Number(null) === 0` is finite, so a naive guard makes an unresolved device
  // look like one that consumes no points -- silently understating demand.
  const result = await runBridge({
    items: [makeBoqItem("boq-null-units")],
    profiles: {
      "boq-null-units": { profile: JSON.stringify({
        boqItem: {
          slcResourceClassification: {
            state: "UNRESOLVED",
            family: "Unknown family",
            unitsPerDevice: null,
            demandUnits: null,
            addressability: null,
            quantity: { value: 7, source: "BOQ", status: "VALID" },
            reason: "no evidence",
            classifierVersion: "v1",
          },
        },
      }) },
    },
    understanding: {},
    quantity: { "boq-null-units": { value: 7, source: "BOQ", status: "VALID" } },
  });
  assert.equal(result.generatedFrom.populations[0].unitsPerDevice, null, "null stays null, never 0");
  assert.equal(result.generatedFrom.populations[0].slcState, "UNRESOLVED");
});

test("the result is shaped for the sizing writer's dependencies.demand contract", async () => {
  const result = await runBridge({ items: [makeBoqItem("boq-shape")], profiles: {}, understanding: {}, quantity: {} });
  for (const key of ["version", "projectTotalPoints", "preliminaryTotalPoints", "thresholdStatus", "completeness", "confidence", "knownPointDemand", "unknownPointDemand", "unresolvedPopulations", "populations"]) {
    assert.ok(key in result, "the produced demand must carry " + key);
  }
  assert.equal(result.generatedFrom.producer, "aggregatePreliminaryPointDemand");
});

test("headers and non-approved items never enter the demand population", async () => {
  const rows = [
    makeBoqItem("boq-ok"),
    makeBoqItem("boq-header", { row_type: "Header" }),
    makeBoqItem("boq-not-approved", { approved_for_downstream: 0 }),
  ];
  // The bridge issues ONE query that already filters all three conditions; the
  // test asserts the SQL it issues actually carries those filters, so a future
  // edit cannot silently widen the population. Currency comes from the shared
  // current-evidence subquery (a `FROM (...)` over boq_items, not a bare
  // `FROM boq_items` join), item-kind from the canonical IN predicate.
  let seenSql = "";
  const db = {
    prepare: (sql) => {
      if (sql.includes("boq_items")) seenSql = sql;
      const op = () => ({ first: async () => null, all: async () => ({ results: [rows[0]] }), run: async () => ({}) });
      const b = { ...op(), sql };
      return { ...b, bind: (...a) => op() };
    },
    batch: async () => [],
  };
  await produceProjectPreliminaryPointDemand({
    db,
    projectId: PROJECT,
    loadCurrentProfile: async () => null,
    loadApprovedUnderstanding: async () => null,
    currentSelectedQuantity: async () => ({ value: 1, source: "BOQ", status: "VALID" }),
  });
  assert.match(seenSql, /approved_for_downstream\s*=\s*1/, "only downstream-approved items");
  assert.match(seenSql, /row_type\s+IN\s*\(\s*'Item'\s*,\s*'BOQ Item'\s*\)/, "headers are excluded via the canonical item predicate, never <> 'Header'");
  assert.doesNotMatch(seenSql, /row_type\s*<>/, "the hand-typed <> exclusion must not survive alongside the canonical predicate");
  assert.match(seenSql, /documentVersionGoverningPredicate|document_supersessions|governing/i, "currency must flow through the governed version rule, not a bare extraction join");
});
