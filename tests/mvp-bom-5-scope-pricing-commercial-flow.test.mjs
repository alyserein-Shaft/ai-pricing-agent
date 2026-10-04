/**
 * MVP-BOM-5, Phases 6-8 -- SCOPE-sourced commercial pricing on the governed
 * production chain.
 *
 * Failing-before evidence (captured before any Phase 6-8 implementation):
 *   - worker/scope-pricing-input.mjs does not exist, so the module-level
 *     import below fails the whole file with ERR_MODULE_NOT_FOUND.
 *   - persistRun's 29-column pricing_lines INSERT omits the 0015
 *     NOT NULL `source_type`/`source_product_id` + scope columns, so every
 *     SCOPE-shaped writer fails with `NOT NULL constraint failed:
 *     pricing_lines.source_type` on the real chain.
 *   - persistRun's idempotency lookup (`l.boq_item_id=?` with a NULL SCOPE
 *     boq_item_id) matches nothing, so a repeated identical SCOPE write
 *     would duplicate the line instead of returning the existing run.
 *   - loadCanonicalPricingTotals INNER-JOINs boq_items, so a persisted
 *     SCOPE line (NULL boq_item_id) is silently dropped from canonical
 *     approved-current totals (lineCount 0).
 *   - the approval path rebuilds the cost from runLines[0].boq_item_id, so
 *     approving a SCOPE run (NULL boq_item_id) throws before it can ever
 *     reach an approval decision.
 *
 * Green-after contract: SCOPE pricing flows through the SAME single cost
 * model (calculatePricingLine) that PRODUCT pricing uses, with every
 * PRODUCT authority gate preserved, and persists/reads/approves SCOPE lines
 * by their own logical identity (kind + system + source_product_id +
 * source_role) with NULL boq/candidate/safety provenance.
 *
 * This file runs against the REAL drizzle-active chain (no mocks) using
 * tests/helpers/active-chain.mjs + tests/fixtures/mvp-bom-5-seed.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { openEmptyDatabase, applyActiveChain } from "./helpers/active-chain.mjs";
import {
  IDS,
  seedProductGraph,
  insertProductPricingLine,
} from "./fixtures/mvp-bom-5-seed.mjs";
import {
  SCOPE_KIND_PANEL_SIZING,
  SCOPE_ROLE_LOOP_EXPANSION_UNIT,
  SCOPE_ROLE_MOUNTING_UNIT,
  resolveScopePricingRequirements,
  loadScopePricingInput,
  buildScopeAuthoritativeCost,
} from "../worker/scope-pricing-input.mjs";
import { loadPricingInput, persistRun } from "../worker/pricing-runtime.mjs";
import { calculatePricingLine } from "../app/domain/pricing-engine.mjs";
import { loadCanonicalPricingTotals } from "../worker/pricing-authority.mjs";
import { handlePricingApi } from "../worker/pricing-api.mjs";

const SCOPE_SYSTEM = "Fire Alarm";
const SCENARIO = { id: IDS.SCENARIO, version_number: 1, project_currency: "SAR", settings: "{}" };

const envFor = (raw) => ({
  DB: {
    prepare(sql) {
      const operation = (values = []) => ({
        first: async () => raw.prepare(sql).get(...values) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...values) }),
        run: async () => raw.prepare(sql).run(...values),
      });
      return { ...operation(), bind: (...values) => operation(values) };
    },
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const r = [];
        for (const s of statements) r.push(await s.run());
        raw.exec("COMMIT");
        return r;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "owner1",
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "owner@test.invalid",
  APP_USER_NAME: "Fixture Owner",
});

const libraryProduct = (raw, id, part, role) =>
  raw
    .prepare(
      `INSERT INTO library_products
       (id,manufacturer_id,part_number,normalized_part_number,description,created_by,created_at,review_status,approved_for_discovery,identity_status,identity_version,product_role)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      IDS.MANUFACTURER,
      part,
      part.toLowerCase(),
      `Scope fixture ${part}`,
      "ingest",
      "now",
      "Reviewed",
      0,
      "Active",
      1,
      role,
    );

const priceRecord = (raw, { id, productId, amount = 10000, currency = "SAR", approval = "Approved", use = "Costing", until = "2099-01-01" }) =>
  raw
    .prepare(
      `INSERT INTO price_records
       (id,product_id,source_id,amount_minor,currency,price_type,validity_state,approval_status,downstream_use,effective_from,valid_until,unit,source_location,reviewed_by,reviewed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      productId,
      "source-1",
      amount,
      currency,
      "Supplier Quote",
      "Valid",
      approval,
      use,
      "2020-01-01",
      until,
      "EA",
      JSON.stringify({ ref: id }),
      "owner1",
      "now",
    );

const expansionCalc = ({
  loopProduct = "product-expander",
  mountingProduct = "product-rmk",
  loopQty = 1,
  mountingQty = 1,
  mountingIncluded = true,
} = {}) => ({
  engineVersion: "fire-alarm-panel-sizing-snapshot-1.1.0",
  sizing: {
    status: "AUTHORITATIVE_PANEL_SIZING",
    panels: [],
    projectTotal: {
      requiredExpansionQuantity: loopQty,
      mountingUnitQuantity: mountingQty,
      anyInsufficientEvidence: false,
      anyCapacityExceeded: false,
      anyConflict: false,
    },
  },
  panels: [
    {
      panelId: "FACP-1",
      demand: { detectors: 150, modules: 0 },
      panelCapacity: {
        nativeLoops: 1,
        detectorsPerLoop: 100,
        modulesPerLoop: 100,
        systemPointCeiling: 500,
      },
      expansionOptions: {
        loopExpansionUnit: { productId: loopProduct, partNumber: "6815", loopsAddedPerUnit: 1 },
        mountingUnit: mountingIncluded
          ? { productId: mountingProduct, partNumber: "5815RMK", capacityPerMountingUnit: 2, quantity: mountingQty }
          : undefined,
      },
      requiredAdditionalLoops: 1,
      requiredExpansionQuantity: loopQty,
      status: "EXPANSION_REQUIRED",
    },
  ],
});

const writeSnapshot = (raw, over = {}) =>
  raw
    .prepare(
      `INSERT INTO fire_alarm_panel_sizing_snapshots
       (id,project_id,version_number,input_fingerprint,engine_version,status,input_json,calculation_json,dossier_json,reason,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      over.id || "ps-1",
      IDS.PROJECT,
      over.versionNumber || 1,
      over.fingerprint || "snap-fp-v1",
      "fire-alarm-panel-sizing-snapshot-1.1.0",
      over.status || "COMPLETED",
      JSON.stringify({ allocations: [], panels: [], provenance: {}, reason: over.reason || "Fixture snapshot" }),
      JSON.stringify(over.calculation || expansionCalc()),
      "{}",
      over.reason || "Fixture snapshot",
      "owner1",
      "now",
    );

const seed = (options = {}) => {
  const opened = openEmptyDatabase();
  applyActiveChain(opened.db);
  opened.db.exec("PRAGMA foreign_keys=OFF");
  seedProductGraph(opened.db);
  const raw = opened.db;
  libraryProduct(raw, "product-expander", "6815", "Loop Card");
  libraryProduct(raw, "product-rmk", "5815RMK", "Enclosure");
  libraryProduct(raw, "product-expander-2", "6815-X", "Loop Card");
  priceRecord(raw, { id: "price-expander", productId: "product-expander" });
  priceRecord(raw, { id: "price-rmk", productId: "product-rmk" });
  priceRecord(raw, { id: "price-expander-2", productId: "product-expander-2" });
  priceRecord(raw, { id: "price-expander-usd", productId: "product-expander", amount: 1000, currency: "USD" });
  priceRecord(raw, { id: "price-expander-eur", productId: "product-expander", currency: "EUR" });
  priceRecord(raw, { id: "price-expander-needs-review", productId: "product-expander", approval: "Needs Review" });
  if (!options.withoutSnapshot) {
    writeSnapshot(raw, {});
    for (const extra of options.additionalSnapshots || []) writeSnapshot(raw, extra);
  }
  return { raw, env: envFor(raw), scenario: SCENARIO, close: () => opened.close() };
};

const loopPrice = async (env, { productId = "product-expander", selectedPriceSourceId = "price-expander", body = {} } = {}) => {
  const input = await loadScopePricingInput(env.DB, {
    projectId: IDS.PROJECT,
    scenario: SCENARIO,
    scopeKey: {
      engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
      system: SCOPE_SYSTEM,
      sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
      sourceProductId: productId,
    },
    body: { selectedPriceSourceId, ...body },
    allowExpiredOrMissingValidity: false,
  });
  const result = calculatePricingLine(input);
  const lock = buildScopeAuthoritativeCost({ result, input });
  return { input: { ...input, authoritativeCost: lock }, result, lock };
};

const scopePersist = async (env, over = {}) => {
  const { input, result } = await loopPrice(env, over);
  return persistRun(env.DB, {
    projectId: IDS.PROJECT,
    scenario: SCENARIO,
    boqItemId: undefined,
    candidateId: undefined,
    input,
    result,
    userId: "owner1",
    role: "Project Manager",
    reason: "Price the governed expansion requirement.",
  });
};

const approval = async (env, runId, entityVersion, reason = "Fixture commercial decision reason") =>
  handlePricingApi(
    new Request(`http://localhost/api/pricing/runs/${runId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "mvp-bom-5" },
      body: JSON.stringify({ entityVersion, reason }),
    }),
    env,
  );

// ---------------------------------------------------------------- Phase 6

test("MVP-BOM-5-P6 the current sizing snapshot resolves distinct loop and mounting requirements", async () => {
  const { env, close } = seed();
  try {
    const resolved = await resolveScopePricingRequirements(env.DB, {
      projectId: IDS.PROJECT,
      system: SCOPE_SYSTEM,
      engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.snapshot.id, "ps-1");
    assert.equal(resolved.snapshot.fingerprint, "snap-fp-v1");
    assert.deepEqual(resolved.requirements, [
      { sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT, sourceProductId: "product-expander", quantity: 1, unit: "EA" },
      { sourceRole: SCOPE_ROLE_MOUNTING_UNIT, sourceProductId: "product-rmk", quantity: 1, unit: "EA" },
    ]);
  } finally {
    close();
  }
});

test("MVP-BOM-5-P6 loadScopePricingInput fails closed when no sizing snapshot exists", async () => {
  const { env, close } = seed({ withoutSnapshot: true });
  try {
    await assert.rejects(
      loadScopePricingInput(env.DB, {
        projectId: IDS.PROJECT,
        scenario: SCENARIO,
        scopeKey: {
          engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
          system: SCOPE_SYSTEM,
          sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
          sourceProductId: "product-expander",
        },
        body: { selectedPriceSourceId: "price-expander" },
      }),
      (error) => error.code === "SCOPE_SNAPSHOT_REQUIRED",
    );
  } finally {
    close();
  }
});

test("MVP-BOM-5-P6 loadScopePricingInput fails closed when the latest snapshot is not COMPLETED", async () => {
  const { raw, env, close } = seed({ withoutSnapshot: true });
  try {
    writeSnapshot(raw, { id: "ps-draft", fingerprint: "draft-fp", status: "DRAFT" });
    await assert.rejects(
      loadScopePricingInput(env.DB, {
        projectId: IDS.PROJECT,
        scenario: SCENARIO,
        scopeKey: {
          engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
          system: SCOPE_SYSTEM,
          sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
          sourceProductId: "product-expander",
        },
        body: { selectedPriceSourceId: "price-expander" },
      }),
      (error) => error.code === "SCOPE_SNAPSHOT_NOT_COMPLETED",
    );
  } finally {
    close();
  }
});

test("MVP-BOM-5-P6 fail closed when sizing proves no expansion requirement for the scope role", async () => {
  const { env, close } = seed({
    additionalSnapshots: [{ id: "ps-none", versionNumber: 2, fingerprint: "none-fp", calculation: expansionCalc({ mountingIncluded: false }) }],
  });
  try {
    await assert.rejects(
      loadScopePricingInput(env.DB, {
        projectId: IDS.PROJECT,
        scenario: SCENARIO,
        scopeKey: {
          engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
          system: SCOPE_SYSTEM,
          sourceRole: SCOPE_ROLE_MOUNTING_UNIT,
          sourceProductId: "product-rmk",
        },
        body: { selectedPriceSourceId: "price-rmk" },
      }),
      (error) => error.code === "NO_REQUIREMENT_FOUND",
    );
  } finally {
    close();
  }
});

test("MVP-BOM-5-P6 fail closed when the requested requirement identity is no longer current", async () => {
  const { env, close } = seed();
  try {
    // product-expander-2 is requested, but the current snapshot resolves the
    // loop role to product-expander: identity changed -> not current.
    await assert.rejects(
      loadScopePricingInput(env.DB, {
        projectId: IDS.PROJECT,
        scenario: SCENARIO,
        scopeKey: {
          engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
          system: SCOPE_SYSTEM,
          sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
          sourceProductId: "product-expander-2",
        },
        body: { selectedPriceSourceId: "price-expander-2" },
      }),
      (error) => error.code === "SCOPE_REQUIREMENT_NOT_CURRENT",
    );
  } finally {
    close();
  }
});

test("MVP-BOM-5-P6 loadScopePricingInput normalizes the pure SCOPE pricing input", async () => {
  const { env, close } = seed();
  try {
    const input = await loadScopePricingInput(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      scopeKey: {
        engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
        system: SCOPE_SYSTEM,
        sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
        sourceProductId: "product-expander",
      },
      body: { selectedPriceSourceId: "price-expander" },
      allowExpiredOrMissingValidity: false,
    });
    assert.equal(input.projectId, IDS.PROJECT);
    assert.equal(input.productId, "product-expander");
    assert.equal(input.partNumber, "6815");
    assert.equal(input.manufacturer, "Honeywell");
    assert.equal(input.quantity, 1);
    assert.equal(input.unit, "EA");
    assert.equal(input.projectCurrency, "SAR");
    assert.equal(input.safetyDecision, null);
    assert.equal(input.technicalAuthority.validated, true);
    assert.equal(input.source.type, "SCOPE");
    assert.deepEqual(input.source.identity, {
      engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
      system: SCOPE_SYSTEM,
      sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
      sourceProductId: "product-expander",
    });
    assert.equal(input.source.provenance.snapshotId, "ps-1");
    assert.equal(input.source.provenance.snapshotFingerprint, "snap-fp-v1");
    assert.equal(input.versions.scopeSnapshot, "ps-1");
    assert.equal(input.versions.scopeFingerprint, "snap-fp-v1");
    assert.ok(input.priceSources.some((source) => source.id === "price-expander"));
  } finally {
    close();
  }
});

// ---------------------------------------------------------------- Phase 7

test("MVP-BOM-5-P7 calculatePricingLine prices the pure SCOPE input through the single cost model", async () => {
  const { env, close } = seed();
  try {
    const { result } = await loopPrice(env);
    assert.equal(result.status, "Draft Price");
    assert.equal(result.approvalReady, true);
    assert.equal(result.totalCost, 100);
    assert.equal(result.netSelling, 100);
    assert.equal(result.finalValue, 100);
    assert.equal(typeof calculatePricingLine, "function");
  } finally {
    close();
  }
});

test("MVP-BOM-5-P7 identical commercial inputs give byte-identical math to the PRODUCT path", async () => {
  const { env, close } = seed();
  try {
    const scope = await loopPrice(env);
    const base = {
      projectId: IDS.PROJECT,
      productId: "product-expander",
      quantity: 1,
      unit: "EA",
      projectCurrency: "SAR",
      calculatedAt: scope.input.calculatedAt,
      allowExpiredOrMissingValidity: false,
      priceSources: scope.input.priceSources,
      selectedPriceSourceId: "price-expander",
      exchangeRate: null,
      discounts: [],
      costComponents: [],
      sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
      customerDiscount: { percentage: 0 },
      vatRule: { rate: 0 },
      precision: 2,
      manufacturer: "Honeywell",
    };
    const productInput = {
      ...base,
      candidateId: "cand",
      technicalApproval: { status: "Approved", candidateId: "cand" },
      safetyDecision: { id: "sd", priceEligibility: "Eligible" },
    };
    const product = calculatePricingLine(productInput);
    for (const field of ["status", "totalCost", "grossSelling", "customerDiscount", "netSelling", "vat", "finalValue", "margin", "markup"]) {
      assert.equal(scope.result[field], product[field], `single cost model must agree on ${field}`);
    }
    assert.equal(scope.result.approvalReady, product.approvalReady);
  } finally {
    close();
  }
});

test("MVP-BOM-5-P7 revoked sizing authority blocks with SCOPE_SIZING_AUTHORITY_REQUIRED", async () => {
  const { env, close } = seed();
  try {
    const input = await loadScopePricingInput(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      scopeKey: {
        engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
        system: SCOPE_SYSTEM,
        sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
        sourceProductId: "product-expander",
      },
      body: { selectedPriceSourceId: "price-expander" },
    });
    const result = calculatePricingLine({ ...input, technicalAuthority: { validated: false } });
    assert.equal(result.status, "Pricing Blocked");
    assert.ok(result.blockers.includes("SCOPE_SIZING_AUTHORITY_REQUIRED"));
    assert.equal(result.approvalReady, false);
    assert.equal(result.blockers.includes("TECHNICAL_APPROVAL_REQUIRED"), false, "SCOPE never re-flags the PRODUCT technical gate");
  } finally {
    close();
  }
});

test("MVP-BOM-5-P7 foreign-currency governed price fails closed (unsupported currency)", async () => {
  const { env, close } = seed();
  try {
    const input = await loadScopePricingInput(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      scopeKey: {
        engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
        system: SCOPE_SYSTEM,
        sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
        sourceProductId: "product-expander",
      },
      body: { selectedPriceSourceId: "price-expander-eur" },
    });
    assert.throws(
      () => calculatePricingLine(input),
      (error) => error.code === "UNSUPPORTED_CURRENCY",
    );
  } finally {
    close();
  }
});

test("MVP-BOM-5-P7 fixed USD->SAR conversion uses the governed 3.75 rate; SAR->SAR stays 1:1", async () => {
  const { env, close } = seed();
  try {
    const usd = await loopPrice(env, { selectedPriceSourceId: "price-expander-usd" });
    assert.equal(usd.result.totalCost, 37.5, "10.00 USD x 3.75 must equal 37.50 SAR");
    assert.equal(Math.round(usd.result.finalValue * 100), 3750);
    const sar = await loopPrice(env);
    assert.equal(sar.result.finalValue, 100, "SAR->SAR stays 1:1");
  } finally {
    close();
  }
});

// ---------------------------------------------------------------- Phase 8

test("MVP-BOM-5-P8 persistRun writes a valid SCOPE pricing line with NULL provenance and full source identity", async () => {
  const { env, close } = seed();
  try {
    const persisted = await scopePersist(env);
    assert.equal(persisted.status, "Draft Price");
    assert.equal(persisted.version, 2, "seed leaves pricing run version 1 in sc-1");
    const line = await env.DB.prepare("SELECT * FROM pricing_lines WHERE pricing_run_id=?").bind(persisted.runId).first();
    assert.equal(line.boq_item_id, null);
    assert.equal(line.candidate_id, null);
    assert.equal(line.safety_decision_id, null);
    assert.equal(line.product_id, "product-expander");
    assert.equal(line.source_type, "SCOPE");
    assert.equal(line.engineering_scope_kind, SCOPE_KIND_PANEL_SIZING);
    assert.equal(line.system, SCOPE_SYSTEM);
    assert.equal(line.source_role, SCOPE_ROLE_LOOP_EXPANSION_UNIT);
    assert.equal(line.source_snapshot_id, "ps-1");
    assert.equal(line.source_fingerprint, "snap-fp-v1");
    assert.equal(line.source_product_id, "product-expander");
    assert.equal(line.approval_ready, 1);
    assert.equal(Number(line.total_cost_minor), 10000);
    const run = await env.DB.prepare("SELECT * FROM pricing_runs WHERE id=?").bind(persisted.runId).first();
    assert.equal(Number(run.version_number), 2);
    assert.equal(JSON.parse(run.locked_versions).authoritativeCost.sourceType, "SCOPE");
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 identical SCOPE replay is idempotent (no duplicate lines, same run)", async () => {
  const { env, close } = seed();
  try {
    // The SAME normalized input object (with its authoritative cost lock) is
    // replayed so the input fingerprint is identical across both writes.
    const { input, result } = await loopPrice(env);
    const write = () =>
      persistRun(env.DB, {
        projectId: IDS.PROJECT,
        scenario: SCENARIO,
        boqItemId: undefined,
        candidateId: undefined,
        input,
        result,
        userId: "owner1",
        role: "Project Manager",
        reason: "Price the governed expansion requirement.",
      });
    const first = await write();
    const second = await write();
    assert.equal(second.runId, first.runId);
    assert.equal(second.lineId, first.lineId);
    assert.equal(second.idempotent, true);
    const { results } = await env.DB.prepare("SELECT COUNT(*) count FROM pricing_lines WHERE pricing_run_id=?").bind(first.runId).all();
    assert.equal(results[0].count, 1);
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 a later run for the same identity supersedes earlier ones in canonical totals", async () => {
  const { raw, env, close } = seed();
  try {
    await scopePersist(env); // v2 from snapshot ps-1 (quantity 1)
    writeSnapshot(raw, { id: "ps-2", versionNumber: 2, fingerprint: "snap-fp-v2", calculation: expansionCalc({ loopQty: 2 }) });
    const fresh = await loopPrice(env);
    const next = await persistRun(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      boqItemId: undefined,
      candidateId: undefined,
      input: fresh.input,
      result: fresh.result,
      userId: "owner1",
      role: "Project Manager",
      reason: "Snapshot v2 raises the expansion quantity.",
    });
    assert.equal(next.version, 3);
    const totals = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.equal(totals.lineCount, 1, "only the current identity line may enter canonical totals");
    assert.equal(totals.costMinor, 20000, "the current line prices 2 units at 100.00 each");
    const line = await env.DB.prepare("SELECT * FROM pricing_lines WHERE pricing_run_id=?").bind(next.runId).first();
    assert.equal(line.source_snapshot_id, "ps-2");
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 product X->Y for the same role is a new logical identity; both lineages stay current", async () => {
  const { raw, env, close } = seed();
  try {
    const x = await scopePersist(env); // identity X in v2
    writeSnapshot(raw, {
      id: "ps-2",
      versionNumber: 2,
      fingerprint: "snap-fp-v2",
      calculation: expansionCalc({ loopProduct: "product-expander-2", mountingProduct: "product-rmk" }),
    });
    const input = await loadScopePricingInput(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      scopeKey: {
        engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
        system: SCOPE_SYSTEM,
        sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
        sourceProductId: "product-expander-2",
      },
      body: { selectedPriceSourceId: "price-expander-2" },
    });
    const result = calculatePricingLine(input);
    const y = await persistRun(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      boqItemId: undefined,
      candidateId: undefined,
      input: { ...input, authoritativeCost: buildScopeAuthoritativeCost({ result, input }) },
      result,
      userId: "owner1",
      role: "Project Manager",
      reason: "Snapshot v2 resolves the loop role to product-expander-2.",
    });
    assert.notEqual(y.runId, x.runId);
    const totals = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.equal(totals.lineCount, 2, "X-lineage and Y-lineage are two distinct current identities");
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 the same product in two roles stays two distinct current lines", async () => {
  const { env, close } = seed({
    additionalSnapshots: [
      { id: "ps-2", versionNumber: 2, fingerprint: "snap-fp-v2", calculation: expansionCalc({ mountingProduct: "product-expander" }) },
    ],
  });
  try {
    const loop = await scopePersist(env); // v2, role LOOP, product-expander
    const mountingInput = await loadScopePricingInput(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      scopeKey: {
        engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
        system: SCOPE_SYSTEM,
        sourceRole: SCOPE_ROLE_MOUNTING_UNIT,
        sourceProductId: "product-expander",
      },
      body: { selectedPriceSourceId: "price-expander" },
    });
    const mountingResult = calculatePricingLine(mountingInput);
    const mounting = await persistRun(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      boqItemId: undefined,
      candidateId: undefined,
      input: { ...mountingInput, authoritativeCost: buildScopeAuthoritativeCost({ result: mountingResult, input: mountingInput }) },
      result: mountingResult,
      userId: "owner1",
      role: "Project Manager",
      reason: "The same expansion product serves the mounting role.",
    });
    assert.notEqual(mounting.runId, loop.runId);
    const totals = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.equal(totals.lineCount, 2);
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 canonical approved-current totals include the current SCOPE line", async () => {
  const { env, close } = seed();
  try {
    const totals = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.equal(totals.lineCount, 0, "before any SCOPE write");
    await scopePersist(env);
    const withScope = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.deepEqual(withScope, { currency: "SAR", costMinor: 10000, subtotalMinor: 10000, lineCount: 1, selectedScenarioId: IDS.SCENARIO });
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 superseded SCOPE runs are excluded from canonical totals", async () => {
  const { env, close } = seed();
  try {
    const persisted = await scopePersist(env);
    let totals = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.equal(totals.lineCount, 1);
    await env.DB.prepare("UPDATE pricing_runs SET superseded_at=? WHERE id=?").bind("2026-09-01T00:00:00.000Z", persisted.runId).run();
    totals = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.equal(totals.lineCount, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 non-governed price evidence persists a non-approval-ready line excluded from totals", async () => {
  const { env, close } = seed();
  try {
    const { input, result } = await loopPrice(env, { selectedPriceSourceId: "price-expander-needs-review" });
    assert.equal(result.status, "Pricing Blocked");
    assert.equal(result.approvalReady, false);
    const persisted = await persistRun(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      boqItemId: undefined,
      candidateId: undefined,
      input,
      result,
      userId: "owner1",
      role: "Project Manager",
      reason: "Price evidence awaits governance.",
    });
    const line = await env.DB.prepare("SELECT * FROM pricing_lines WHERE pricing_run_id=?").bind(persisted.runId).first();
    assert.equal(line.approval_ready, 0);
    const totals = await loadCanonicalPricingTotals(env.DB, { projectId: IDS.PROJECT, scenarioId: IDS.SCENARIO, currency: "SAR" });
    assert.equal(totals.lineCount, 0, "a non-approval-ready SCOPE line never enters canonical totals");
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 approval of a current SCOPE run succeeds through the real approval handler", async () => {
  const { env, close } = seed();
  try {
    const persisted = await scopePersist(env);
    const response = await approval(env, persisted.runId, persisted.version);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "Approved");
    assert.equal(body.approvalId.startsWith("pricingapproval_"), true);
    const approvalRow = await env.DB.prepare("SELECT * FROM pricing_approvals WHERE pricing_run_id=? AND approval_type='Commercial Price'").bind(persisted.runId).first();
    assert.equal(approvalRow.status, "Approved");
    assert.equal(Number(approvalRow.entity_version), 2);
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 approval of a run on a stale snapshot fingerprint is blocked, then a fresh run approves", async () => {
  const { raw, env, close } = seed();
  try {
    const stale = await scopePersist(env); // priced from ps-1
    writeSnapshot(raw, { id: "ps-2", versionNumber: 2, fingerprint: "snap-fp-v2" });
    const blocked = await approval(env, stale.runId, stale.version);
    assert.equal(blocked.status, 409);
    const blockedBody = await blocked.json();
    assert.ok(blockedBody.error && blockedBody.error.code, "a stale SCOPE run must be blocked before approval");
    // A fresh run against the current snapshot still approves.
    const fresh = await scopePersist(env);
    const ok = await approval(env, fresh.runId, fresh.version);
    assert.equal(ok.status, 200);
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 the display summary includes current SCOPE lines alongside PRODUCT lines", async () => {
  const { raw, env, close } = seed();
  try {
    insertProductPricingLine(raw, { id: "pl-prod-mixed", runId: IDS.RUN, projectId: IDS.PROJECT, boqItemId: IDS.BOQ_ITEM, candidateId: IDS.CANDIDATE, safetyDecisionId: IDS.SAFETY, productId: IDS.PRODUCT });
    await scopePersist(env);
    const response = await handlePricingApi(
      new Request(`http://localhost/api/pricing/projects/${IDS.PROJECT}/summary?scenarioId=${IDS.SCENARIO}`, {
        method: "GET",
        headers: { "x-request-id": "mvp-bom-5" },
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "Calculated");
    assert.equal(body.summary.itemCount, 2);
    assert.equal(body.summary.pricedItemCount, 2);
    assert.equal(body.summary.finalValue, 101, "PRODUCT line 1.00 + SCOPE line 100.00");
  } finally {
    close();
  }
});

// ------------------------------------------------------- PRODUCT guards

test("MVP-BOM-5-P8 PRODUCT loadPricingInput still fails closed without a BOQ item", async () => {
  const { env, close } = seed();
  try {
    await assert.rejects(
      loadPricingInput(env.DB, {
        projectId: IDS.PROJECT,
        boqItemId: "b-missing",
        candidateId: IDS.CANDIDATE,
        scenario: SCENARIO,
        body: {},
      }),
      (error) => error.code === "BOQ_ITEM_NOT_FOUND",
    );
  } finally {
    close();
  }
});

test("MVP-BOM-5-P7 PRODUCT calculatePricingLine keeps TECHNICAL_APPROVAL_REQUIRED and SAFETY_PRICE_ELIGIBILITY_REQUIRED", async () => {
  const { env, close } = seed();
  try {
    const input = await loadScopePricingInput(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      scopeKey: {
        engineeringScopeKind: SCOPE_KIND_PANEL_SIZING,
        system: SCOPE_SYSTEM,
        sourceRole: SCOPE_ROLE_LOOP_EXPANSION_UNIT,
        sourceProductId: "product-expander",
      },
      body: { selectedPriceSourceId: "price-expander" },
    });
    const productShaped = {
      projectId: IDS.PROJECT,
      productId: "product-expander",
      quantity: 1,
      unit: "EA",
      projectCurrency: "SAR",
      calculatedAt: input.calculatedAt,
      allowExpiredOrMissingValidity: false,
      priceSources: input.priceSources,
      selectedPriceSourceId: "price-expander",
      exchangeRate: null,
      discounts: [],
      costComponents: [],
      sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
      customerDiscount: { percentage: 0 },
      vatRule: { rate: 0 },
      precision: 2,
      manufacturer: "Honeywell",
      candidateId: "cand",
    };
    const blocked = calculatePricingLine(productShaped);
    assert.equal(blocked.status, "Pricing Blocked");
    assert.ok(blocked.blockers.includes("TECHNICAL_APPROVAL_REQUIRED"));
    assert.ok(blocked.blockers.includes("SAFETY_PRICE_ELIGIBILITY_REQUIRED"));
    assert.ok(!blocked.blockers.includes("SCOPE_SIZING_AUTHORITY_REQUIRED"));
  } finally {
    close();
  }
});

test("MVP-BOM-5-P8 PRODUCT persistRun backfills source identity (PRODUCT, scope identity NULL)", async () => {
  const { env, close } = seed();
  try {
    const input = await loadPricingInput(env.DB, {
      projectId: IDS.PROJECT,
      boqItemId: IDS.BOQ_ITEM,
      candidateId: IDS.CANDIDATE,
      scenario: SCENARIO,
      body: { selectedPriceSourceId: "price-expander" },
    });
    const result = calculatePricingLine({ ...input, source: undefined });
    const persisted = await persistRun(env.DB, {
      projectId: IDS.PROJECT,
      scenario: SCENARIO,
      boqItemId: IDS.BOQ_ITEM,
      candidateId: IDS.CANDIDATE,
      input,
      result,
      userId: "owner1",
      role: "Project Manager",
      reason: "PRODUCT regression: the backfilled source identity must not change.",
    });
    const line = await env.DB.prepare("SELECT * FROM pricing_lines WHERE pricing_run_id=?").bind(persisted.runId).first();
    assert.equal(line.source_type, "PRODUCT");
    assert.equal(line.engineering_scope_kind, null);
    assert.equal(line.system, null);
    assert.equal(line.source_role, null);
    assert.equal(line.source_snapshot_id, null);
    assert.equal(line.source_fingerprint, null);
    assert.equal(line.source_product_id, line.product_id);
    assert.equal(line.boq_item_id, IDS.BOQ_ITEM);
    assert.equal(line.candidate_id, IDS.CANDIDATE);
  } finally {
    close();
  }
});