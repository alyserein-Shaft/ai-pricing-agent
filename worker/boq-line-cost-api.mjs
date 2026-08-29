// Phase 5 cost-continuity fix -- the per-line, per-project Cost Build-Up
// read model. This is a COMPOSITE layer only: material pricing reuses the
// EXISTING, already-mature pricing engine exactly as built
// (app/domain/pricing-engine.mjs's calculatePricingLine, and
// worker/pricing-api.mjs's own loadPricingInput/persistRun) -- no new price
// table, no new source-precedence rule, no new currency-conversion logic.
// The only genuinely new pieces are: (a) the composite
// price-evidence/readiness classification (app/domain/cost-buildup-model.mjs),
// (b) reading the BOM read model (Vertical Slice 2) for quantity/primary
// product context, and (c) explicitly never surfacing the selling-price
// fields calculatePricingLine also computes (grossSelling/netSelling/margin/
// vat/finalValue) -- a neutral 0% markup/discount/VAT input is passed so
// nothing resembling real commercial logic is exercised, and this module's
// own response never includes those fields regardless.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { loadPricingInput, persistRun } from "./pricing-runtime.mjs";
import { calculatePricingLine } from "../app/domain/pricing-engine.mjs";
import { buildLineBomModel } from "./boq-line-bom-api.mjs";
import {
  derivePriceEvidenceStatus,
  selectCostEvidence,
  deriveCostReadiness,
  selectCostDecisionQuestion,
  isBomComponentIncludedInCosting,
  priceMaterialComponent,
  aggregateMaterialCost,
  selectMaterialCostDecisionQuestion,
} from "../app/domain/cost-buildup-model.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };

const ownedItem = (db, itemId, userId) => db.prepare(
  "SELECT b.id, b.project_id, b.system_value FROM boq_items b JOIN projects p ON p.id=b.project_id WHERE b.id=? AND p.owner_user_id=?",
).bind(itemId, userId).first();

// The same "current technical selection" resolution the BOM read model uses
// (Vertical Slice 2) -- reused here rather than re-derived, so Cost
// Build-Up and BOM always agree on which product this line is costing.
const primarySelection = async (db, itemId) => {
  const approved = await db.prepare(
    `SELECT c.id candidateId, c.product_id productId, 1 approved FROM safety_decisions d JOIN product_match_candidates c ON c.id=d.candidate_id
     WHERE d.boq_item_id=? AND d.superseded_at IS NULL AND d.technical_eligibility LIKE 'Eligible%' ORDER BY d.version_number DESC LIMIT 1`,
  ).bind(itemId).first();
  if (approved) return approved;
  const top = await db.prepare(
    "SELECT c.id candidateId, c.product_id productId FROM product_match_candidates c JOIN product_match_runs r ON r.id=c.match_run_id WHERE r.boq_item_id=? AND r.superseded_at IS NULL ORDER BY c.rank LIMIT 1",
  ).bind(itemId).first();
  return top ? { ...top, approved: false } : null;
};

// A pricing scenario is a real, existing authoritative concept
// (pricing_scenarios, already governed by worker/pricing-api.mjs) that
// nothing in the Cost Build-Up journey should require an engineer to
// configure before seeing ANY cost visibility. Absent one, this
// provisions a single neutral default (SAR, 0% markup/discount/VAT,
// Draft status) -- a technical bootstrap, never a commercial decision --
// and records it as the project's selected scenario via the exact same
// project_dashboard_profiles column the existing scenario-selection
// endpoint already writes.
const ensureDefaultScenario = async (db, projectId, userId) => {
  const profile = await db.prepare("SELECT selected_pricing_scenario_id FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL").bind(projectId).first();
  if (profile?.selected_pricing_scenario_id) {
    const existing = await db.prepare("SELECT * FROM pricing_scenarios WHERE id=? AND deleted_at IS NULL AND superseded_at IS NULL").bind(profile.selected_pricing_scenario_id).first();
    if (existing) return existing;
  }
  const scenarioId = id("scenario"), stamp = now();
  await db.batch([
    db.prepare("INSERT INTO pricing_scenarios (id, project_id, name, mode, version_number, project_currency, status, assumptions, settings, created_by) VALUES (?, ?, 'Default Cost Build-Up', 'Base Case', 1, 'SAR', 'Draft', '[]', '{}', ?)").bind(scenarioId, projectId, userId),
    db.prepare(
      `INSERT INTO project_dashboard_profiles (project_id, currency, selected_pricing_scenario_id, selected_pricing_scenario_at, selected_pricing_scenario_by, selected_pricing_scenario_reason, updated_by)
       VALUES (?, 'SAR', ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET selected_pricing_scenario_id=excluded.selected_pricing_scenario_id, selected_pricing_scenario_at=excluded.selected_pricing_scenario_at, selected_pricing_scenario_by=excluded.selected_pricing_scenario_by, selected_pricing_scenario_reason=excluded.selected_pricing_scenario_reason, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`,
    ).bind(projectId, scenarioId, stamp, userId, "Auto-provisioned neutral default scenario for Cost Build-Up visibility (0% markup/discount/VAT; no commercial strategy applied)", userId),
  ]);
  return { id: scenarioId, project_id: projectId, name: "Default Cost Build-Up", mode: "Base Case", version_number: 1, project_currency: "SAR", status: "Draft" };
};

// An engineer's explicit price-source choice must persist even when the
// underlying pricing_lines row itself is "Pricing Blocked" for an unrelated
// reason (e.g. technical/safety approval still outstanding) --
// calculatePricingLine only ever records selected_price_record_id on a
// SUCCESSFUL run, so a blocked run would otherwise silently forget the
// engineer's own selection on every re-read. Reusing engineering_facts (the
// same generic, versioned, project-scoped evidence table Vertical Slice 2's
// BOM accessory selection already uses) for one more predicate keeps this
// choice durable without a new table.
// Extended to be product-scoped (a BOQ line can now have several priced
// products at once -- the primary plus every included BOM component), while
// staying compatible with rows written before this extension existed (those
// never recorded a productId at all -- read as "the primary product's own
// selection" exactly as they always were). Primary lookups accept both a
// legacy no-productId row and an explicit match on the primary's own
// productId; a component lookup only ever accepts an EXACT productId match,
// so one component's selection can never leak onto another's.
const loadPriceSourceSelection = async (db, itemId, { productId = null, isPrimary = false } = {}) => {
  const rows = await db.prepare(
    "SELECT value FROM engineering_facts WHERE entity_type='BOQ Item' AND entity_id=? AND predicate='Cost Price Source Selection' AND status='Active' AND deleted_at IS NULL ORDER BY version_number DESC",
  ).bind(itemId).all();
  for (const row of rows.results || []) {
    const value = parse(row.value, {});
    const rowProductId = value?.productId || null;
    const matches = isPrimary ? (!rowProductId || rowProductId === productId) : rowProductId === productId;
    if (matches) return value?.selectedPriceSourceId || null;
  }
  return null;
};
const recordPriceSourceSelection = async (db, { projectId, itemId, userId, productId, isPrimary = false, selectedPriceSourceId, reason }) => {
  const rows = await db.prepare(
    "SELECT id, version_number, value FROM engineering_facts WHERE entity_type='BOQ Item' AND entity_id=? AND predicate='Cost Price Source Selection' AND status='Active' AND deleted_at IS NULL ORDER BY version_number DESC",
  ).bind(itemId).all();
  const previous = (rows.results || []).find((row) => { const value = parse(row.value, {}); const rowProductId = value?.productId || null; return isPrimary ? (!rowProductId || rowProductId === productId) : rowProductId === productId; });
  const newId = id("engfact"), stamp = now();
  const statements = [];
  if (previous) statements.push(db.prepare("UPDATE engineering_facts SET status='Superseded', effective_to=?, superseded_by_id=? WHERE id=?").bind(stamp, newId, previous.id));
  statements.push(db.prepare(
    `INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, previous_version_id, status, confidence, version_number, change_reason, changed_by, model_version)
     VALUES (?, ?, 'BOQ Item', ?, 'Cost Price Source Selection', ?, 'Object', 'Equal', 'Engineer Decision', 'BOQ Item', ?, ?, 'Active', 100, ?, ?, ?, 'cost-buildup-model-1.0.0')`,
  ).bind(newId, projectId, itemId, JSON.stringify({ selectedPriceSourceId, productId }), itemId, previous?.id || null, Number(previous?.version_number || 0) + 1, reason, userId));
  await db.batch(statements);
};

const loadApprovedExchangeRate = async (db, projectId) => {
  const row = await db.prepare("SELECT * FROM pricing_exchange_rates WHERE project_id=? AND approval_status='Approved' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(projectId).first();
  return row ? { from: row.from_currency, to: row.to_currency, rate: Number(row.rate), source: row.source, version: row.version_number, approvalStatus: row.approval_status, validUntil: row.valid_until } : null;
};

// Prices every BOM component actually included in the approved BOM (per
// isBomComponentIncludedInCosting -- required, resolved-conditional, or an
// engineer-selected optional/alternative) using the exact same reusable
// engine primitives the primary product's own pricing already uses
// (selectPriceSources/convertCurrency/applyDiscounts/quantityMultiplier via
// priceMaterialComponent), reading each component's own price_records the
// same way loadPricingInput reads the primary's.
const priceIncludedComponents = async (db, { itemId, projectId, bomComponents = [], exchangeRate, projectCurrency, at }) => {
  const included = bomComponents.filter(isBomComponentIncludedInCosting);
  const priced = [];
  for (const component of included) {
    const selectedPriceSourceId = await loadPriceSourceSelection(db, itemId, { productId: component.accessoryProductId });
    const recordsRows = await db.prepare(
      "SELECT r.*, s.name supplier_name FROM price_records r LEFT JOIN suppliers s ON s.id=r.supplier_id WHERE r.product_id=? AND (r.project_id IS NULL OR r.project_id=?)",
    ).bind(component.accessoryProductId, projectId).all();
    const priceSources = (recordsRows.results || []).map((entry) => ({
      id: entry.id, productId: entry.product_id, projectId: entry.project_id,
      amount: entry.amount_minor / 100, currency: entry.currency, priceType: entry.price_type,
      approvalStatus: entry.approval_status, downstreamUse: entry.downstream_use,
      effectiveFrom: entry.effective_from, validUntil: entry.valid_until, minimumQuantity: entry.minimum_quantity,
      reference: parse(entry.source_location, {}).reference || entry.id, supplier: entry.supplier_name, reliability: parse(entry.terms, {}).reliability,
    }));
    const result = priceMaterialComponent({
      productId: component.accessoryProductId, quantity: component.quantity?.value, unit: component.quantity?.unit || "Each",
      priceSources, selectedPriceSourceId, projectId, at, exchangeRate, projectCurrency,
    });
    const scope = component.role === "REQUIRED_COMPONENT" ? "Required Component" : component.role === "CONDITIONAL_COMPONENT" ? "Conditional Component" : "Optional Component";
    priced.push({ scope, role: component.role, partNumber: component.accessoryPartNumber, productId: component.accessoryProductId, relationshipType: component.relationshipType, quantity: component.quantity, priced: result });
  }
  return priced;
};

const currentPricingLine = (db, boqItemId, scenarioId) => db.prepare(
  "SELECT l.* FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id WHERE l.boq_item_id=? AND r.scenario_id=? AND r.superseded_at IS NULL ORDER BY r.version_number DESC LIMIT 1",
).bind(boqItemId, scenarioId).first();

const nonMaterialComponents = async (db, pricingLineId) => {
  if (!pricingLineId) return [];
  const rows = await db.prepare("SELECT * FROM pricing_cost_components WHERE pricing_line_id=? ORDER BY component_type").bind(pricingLineId).all();
  return (rows.results || []).map((row) => ({ id: row.id, type: row.component_type, description: row.description, method: row.method, formula: row.formula, rate: row.rate, quantity: row.quantity, amount: row.amount_minor == null ? null : row.amount_minor / 100, source: parse(row.source, {}), approvalStatus: row.approval_status }));
};

// Never surfaces grossSelling/netSelling/margin/markup/vat/finalValue --
// only the cost-side fields calculatePricingLine already separates cleanly
// at the schema level (pricing_lines has both total_cost_minor and
// gross_selling_minor as distinct columns; this reads only the former
// family of fields).
const costOnlyView = (result) => result ? {
  status: result.status,
  approvalReady: Boolean(result.approvalReady),
  blockers: result.blockers || [],
  selectedSource: result.selectedSource ? { id: result.selectedSource.id, priceType: result.selectedSource.priceType, amount: result.selectedSource.amount, currency: result.selectedSource.currency, reference: result.selectedSource.reference, validity: result.selectedSource.validity } : null,
  conversion: result.conversion || null,
  netMaterialUnitCost: result.netMaterialUnitCost ?? null,
  quantity: result.quantity ?? null,
  materialTotal: result.materialTotal ?? null,
  directCost: result.directCost ?? null,
  totalCost: result.totalCost ?? null,
} : null;

export const buildLineCostModel = async (env, { itemId, userId }) => {
  const item = await ownedItem(env.DB, itemId, userId);
  if (!item) return { error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } };
  const bom = await buildLineBomModel(env, { itemId, userId });
  const bomReady = bom?.readiness?.state === "BOM_READY";
  const selection = bomReady ? await primarySelection(env.DB, itemId) : null;

  if (!bomReady || !selection) {
    return {
      boqItemId: itemId,
      bomReadiness: bom?.readiness || null,
      material: null,
      priceEvidenceStatus: "PRICE_MISSING",
      rankedSources: [],
      nonMaterialComponents: [],
      summary: { currency: "SAR", materialSubtotal: null, serviceSubtotal: null, totalCost: null },
      costDecisionQuestion: null,
      readiness: deriveCostReadiness({ bomReady, priceEvidenceStatus: "PRICE_MISSING", hasOpenCostQuestion: false, exchangeRateMissing: false }),
    };
  }

  const scenario = await ensureDefaultScenario(env.DB, item.project_id, userId);
  const priorLine = await currentPricingLine(env.DB, itemId, scenario.id);
  const engineerSelectedPriceSourceId = await loadPriceSourceSelection(env.DB, itemId, { productId: selection.productId, isPrimary: true });
  // loadPricingInput throws (rather than returning a blocker) when no
  // safety decision exists at all yet for this candidate -- a real,
  // legitimate state for a still-provisional technical selection (Vertical
  // Slice 1 may not have run a formal safety/technical approval yet). That
  // is reported here as an honest "not yet ready" cost state, never a
  // fabricated price or a crash.
  let input, result, primaryFailure = null;
  try {
    input = await loadPricingInput(env.DB, {
      projectId: item.project_id, boqItemId: itemId, candidateId: selection.candidateId, scenario,
      body: {
        selectedPriceSourceId: engineerSelectedPriceSourceId || priorLine?.selected_price_record_id || null,
        // A neutral, non-committal commercial input -- 0% markup, 0%
        // customer discount, 0% VAT -- so calling the shared engine never
        // applies real margin/discount/selling-price logic in this slice; the
        // engine's own selling-price fields are computed as a side effect of
        // its single combined calculation, but this module never reads or
        // returns them (see costOnlyView above).
        sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
        customerDiscount: { percentage: 0 },
        vatRule: { rate: 0 },
      },
    });
    result = calculatePricingLine(input);
  } catch (error) {
    primaryFailure = error;
  }

  // BOM components are governed by the BOM read model's own resolved role
  // (Vertical Slice 2), not by the primary product's technical/safety
  // decision -- so a required base can still be priced (and its gap still
  // reported) even while the primary product's own pricing is blocked or
  // still under review. Total Material Cost, computed below, correctly
  // remains null in that case regardless (the primary itself is reported
  // as a missing component), so nothing is ever silently included.
  const exchangeRate = input?.exchangeRate ?? await loadApprovedExchangeRate(env.DB, item.project_id);
  const projectCurrency = scenario.project_currency;
  const calculatedAt = input?.calculatedAt || now();
  const componentsPriced = await priceIncludedComponents(env.DB, { itemId, projectId: item.project_id, bomComponents: bom.components, exchangeRate, projectCurrency, at: calculatedAt });
  const nonMaterial = await nonMaterialComponents(env.DB, priorLine?.id);
  const serviceSubtotal = nonMaterial.length ? nonMaterial.reduce((sum, entry) => sum + Number(entry.amount || 0), 0) : null;

  if (primaryFailure) {
    const aggregated = aggregateMaterialCost({ primary: { approvalReady: false, status: "PRICE_MISSING", partNumber: bom.primaryProduct?.partNumber, materialTotal: null }, components: componentsPriced });
    const materialCostQuestion = selectMaterialCostDecisionQuestion(componentsPriced.map((entry) => ({ scope: entry.scope, partNumber: entry.partNumber, productId: entry.productId, priced: entry.priced, rankedSources: entry.priced.rankedSources })));
    const totalCost = aggregated.totalMaterialCost != null ? Math.round((aggregated.totalMaterialCost + (serviceSubtotal || 0)) * 100) / 100 : null;
    return {
      boqItemId: itemId,
      bomReadiness: bom.readiness,
      primaryProduct: bom.primaryProduct,
      primaryQuantity: bom.primaryQuantity,
      scenario: { id: scenario.id, name: scenario.name, projectCurrency, status: scenario.status },
      material: null,
      materialBreakdown: componentsPriced.map((entry) => componentBreakdownRow(entry)),
      materialCost: aggregated,
      priceEvidenceStatus: "PRICE_MISSING",
      selectedCostEvidence: null,
      rankedSources: [],
      nonMaterialComponents: nonMaterial,
      exchangeRate,
      exchangeRateMissing: false,
      summary: { currency: projectCurrency, materialSubtotal: aggregated.totalMaterialCost, serviceSubtotal, totalCost },
      costDecisionQuestion: materialCostQuestion,
      currentBlocker: primaryFailure.code === "SAFETY_DECISION_REQUIRED" ? "A safety/technical decision has not been evaluated for this candidate yet." : primaryFailure.message,
      readiness: deriveCostReadiness({ bomReady, priceEvidenceStatus: "PRICE_MISSING", hasOpenCostQuestion: Boolean(materialCostQuestion), exchangeRateMissing: false, materialCostComputed: aggregated.totalMaterialCost != null }),
    };
  }

  const rankedSources = result.sources || [result.selectedSource, ...(result.sourceAlternatives || [])].filter(Boolean);
  const priceEvidenceStatus = derivePriceEvidenceStatus(rankedSources, { at: input.calculatedAt });
  const selectedCostEvidence = selectCostEvidence(rankedSources, input.selectedPriceSourceId);
  const exchangeRateMissing = Boolean(selectedCostEvidence) && selectedCostEvidence.currency !== input.projectCurrency && !input.exchangeRate;
  const hasExplicitSelection = selectedCostEvidence?.selectionBasis === "Engineer Selected";
  // The primary product's own question keeps its exact historical priority
  // and wording (unchanged Cost Build-Up behavior); only once IT is
  // resolved does a gap on an included BOM component ever surface.
  const primaryCostDecisionQuestion = selectCostDecisionQuestion({ priceEvidenceStatus, rankedSources, exchangeRateMissing, sourceCurrency: selectedCostEvidence?.currency, missingCostBasisComponents: [], hasExplicitSelection });
  const componentCostDecisionQuestion = primaryCostDecisionQuestion ? null : selectMaterialCostDecisionQuestion(componentsPriced.map((entry) => ({ scope: entry.scope, partNumber: entry.partNumber, productId: entry.productId, priced: entry.priced, rankedSources: entry.priced.rankedSources })));
  const costDecisionQuestion = primaryCostDecisionQuestion || componentCostDecisionQuestion;

  const aggregated = aggregateMaterialCost({ primary: { approvalReady: Boolean(result.approvalReady), materialTotal: result.materialTotal ?? null, partNumber: bom.primaryProduct?.partNumber, status: result.approvalReady ? "PRICED" : "PRICE_MISSING" }, components: componentsPriced });
  const materialSubtotal = aggregated.totalMaterialCost;
  const totalCost = materialSubtotal != null && serviceSubtotal != null ? Math.round((materialSubtotal + serviceSubtotal) * 100) / 100 : materialSubtotal;

  return {
    boqItemId: itemId,
    bomReadiness: bom.readiness,
    primaryProduct: bom.primaryProduct,
    primaryQuantity: bom.primaryQuantity,
    scenario: { id: scenario.id, name: scenario.name, projectCurrency: scenario.project_currency, status: scenario.status },
    material: costOnlyView(result),
    materialBreakdown: [
      { scope: "Primary Product", role: "PRIMARY_PRODUCT", partNumber: bom.primaryProduct?.partNumber || null, quantity: bom.primaryQuantity, unitCost: result.netMaterialUnitCost ?? null, extendedCost: result.approvalReady ? result.materialTotal : null, evidenceSource: selectedCostEvidence ? `${selectedCostEvidence.priceType} (${selectedCostEvidence.selectionBasis})` : "No price evidence selected" },
      ...componentsPriced.map((entry) => componentBreakdownRow(entry)),
    ],
    materialCost: aggregated,
    priceEvidenceStatus,
    selectedCostEvidence,
    rankedSources: rankedSources.map((entry) => ({ id: entry.id, priceType: entry.priceType, amount: entry.amount, currency: entry.currency, reference: entry.reference, validity: entry.validity, status: entry.status, eligible: entry.eligible, explanation: entry.explanation })),
    nonMaterialComponents: nonMaterial,
    exchangeRate: input.exchangeRate,
    exchangeRateMissing,
    summary: { currency: scenario.project_currency, materialSubtotal, serviceSubtotal, totalCost },
    costDecisionQuestion,
    readiness: deriveCostReadiness({ bomReady, priceEvidenceStatus, hasOpenCostQuestion: Boolean(costDecisionQuestion), exchangeRateMissing, materialCostComputed: materialSubtotal != null }),
  };
};

const componentBreakdownRow = (entry) => ({
  scope: entry.scope, role: entry.role, partNumber: entry.partNumber, relationshipType: entry.relationshipType,
  quantity: entry.quantity, unitCost: entry.priced.netUnitCost ?? null, extendedCost: entry.priced.status === "PRICED" ? entry.priced.extendedCost : null,
  evidenceSource: entry.priced.selectedSource ? `${entry.priced.selectedSource.priceType}` : entry.priced.status === "PRICE_MISSING" ? "No price evidence on record" : entry.priced.status === "AWAITING_SELECTION" ? "Evidence exists — awaiting engineer selection" : entry.priced.status,
});

// Project-level aggregation: system subtotal -> project total.
// Each current, downstream-approved BOQ line is evaluated through the SAME
// Full BOM Cost read model used by the line workspace, so required/resolved
// BOM component costs cannot disappear from the project roll-up.
// lineCostBuilder is injectable only for deterministic regression testing;
// production callers use buildLineCostModel.
export const buildProjectCostSummary = async (
  env,
  { projectId, userId },
  lineCostBuilder = buildLineCostModel,
) => {
  const project = await env.DB.prepare(
    "SELECT id FROM projects WHERE id=? AND owner_user_id=?",
  ).bind(projectId, userId).first();
  if (!project) return { error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } };

  // Project costing must use the same authoritative current-evidence scope
  // as the BOQ workflow: current document version, current non-superseded
  // extraction, real BOQ Item rows only, and only rows approved for
  // downstream processing.
  const rows = await env.DB.prepare(
    `SELECT b.id, COALESCE(b.system_value, 'Unspecified') system
     FROM boq_items b
     JOIN boq_extraction_versions e
       ON e.id=b.extraction_version_id
      AND e.document_id=b.source_document_id
     JOIN documents d
       ON d.id=e.document_id
      AND d.current_version_id=e.document_version_id
      AND d.deleted_at IS NULL
      AND d.archived_at IS NULL
     WHERE b.project_id=?
       AND b.row_type='BOQ Item'
       AND b.approved_for_downstream=1
       AND e.superseded_at IS NULL
       AND e.status IN ('Completed','Needs Review')
     ORDER BY b.sequence, b.id`,
  ).bind(projectId).all();

  const bySystem = new Map();
  const incompleteLines = [];
  let completeLineCount = 0;

  for (const row of rows.results || []) {
    const model = await lineCostBuilder(env, { itemId: row.id, userId });

    if (model.error || model.summary?.totalCost == null) {
      incompleteLines.push({
        boqItemId: row.id,
        system: row.system,
        readiness: model.readiness || null,
        blocker: model.currentBlocker || model.costDecisionQuestion?.question || model.error?.message || "Cost evidence incomplete.",
      });
      continue;
    }

    completeLineCount += 1;
    const cost = Number(model.summary.totalCost);
    const current = bySystem.get(row.system) || { knownCost: 0, completeLines: 0 };
    current.knownCost += cost;
    current.completeLines += 1;
    bySystem.set(row.system, current);
  }

  const systems = [...bySystem.entries()]
    .map(([system, value]) => ({
      system,
      totalCost: Math.round(value.knownCost * 100) / 100,
      completeLineCount: value.completeLines,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  const knownCostSubtotal = Math.round(
    systems.reduce((sum, entry) => sum + entry.totalCost, 0) * 100,
  ) / 100;

  const isComplete = incompleteLines.length === 0;

  return {
    projectId,
    currency: "SAR",
    status: isComplete ? "COST_READY" : "COST_EVIDENCE_INCOMPLETE",
    systems,
    knownCostSubtotal,
    projectTotalCost: isComplete ? knownCostSubtotal : null,
    completeLineCount,
    incompleteLineCount: incompleteLines.length,
    totalLineCount: (rows.results || []).length,
    incompleteLines,
  };
};

export async function handleBoqLineCostApi(request, env) {
  const url = new URL(request.url);
  const readMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/cost$/);
  const answerMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/cost\/answer$/);
  const summaryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/cost-summary$/);
  if (!readMatch && !answerMatch && !summaryMatch) return null;
  if (!env.DB) return json({ error: { code: "COST_MODEL_UNAVAILABLE", message: "Cost model storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);

  if (summaryMatch) {
    if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
    const summary = await buildProjectCostSummary(env, { projectId: decodeURIComponent(summaryMatch[1]), userId: user.id });
    return summary.error ? json(summary, 404) : json(summary);
  }

  const itemId = decodeURIComponent((readMatch || answerMatch)[1]);
  if (readMatch) {
    if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
    const model = await buildLineCostModel(env, { itemId, userId: user.id });
    return model.error ? json(model, 404) : json(model);
  }

  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to answer." } }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: { code: "COST_ANSWER_INVALID", message: "Use the governed cost-answer contract." } }, 400); }
  const reason = String(body.reason || "").trim();
  if (reason.length < 5) return json({ error: { code: "COST_ANSWER_REASON_REQUIRED", message: "Provide a substantive reason for this cost decision." } }, 422);
  const item = await ownedItem(env.DB, itemId, user.id);
  if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
  const selection = await primarySelection(env.DB, itemId);
  if (!selection) return json({ error: { code: "TECHNICAL_SELECTION_REQUIRED", message: "Resolve the technical/BOM decision before recording a cost decision." } }, 409);
  const scenario = await ensureDefaultScenario(env.DB, item.project_id, user.id);

  const runCalculation = async (extra) => {
    const input = await loadPricingInput(env.DB, {
      projectId: item.project_id, boqItemId: itemId, candidateId: selection.candidateId, scenario,
      body: { sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 0 }, ...extra },
    });
    const result = calculatePricingLine(input);
    const persisted = await persistRun(env.DB, { projectId: item.project_id, scenario, boqItemId: itemId, candidateId: selection.candidateId, input, result, userId: user.id, role: "Project User", reason });
    return persisted;
  };

  if (body.kind === "SELECT_PRICE_SOURCE") {
    const selectedPriceSourceId = String(body.selectedPriceSourceId || "").trim();
    if (!selectedPriceSourceId) return json({ error: { code: "COST_ANSWER_SOURCE_REQUIRED", message: "A price source id is required." } }, 422);
    const targetProductId = String(body.productId || "").trim() || null;
    const isComponentSelection = Boolean(targetProductId) && targetProductId !== selection.productId;
    if (isComponentSelection) {
      // A BOM component (a required base, a resolved conditional sounder
      // base, ...) has no persisted pricing_lines row of its own -- it is
      // priced live on every read (priceIncludedComponents), so recording
      // the selection is the entire governed action; there is nothing to
      // re-run here, unlike the primary product's own persisted line.
      await recordPriceSourceSelection(env.DB, { projectId: item.project_id, itemId, userId: user.id, productId: targetProductId, selectedPriceSourceId, reason });
    } else {
      await recordPriceSourceSelection(env.DB, { projectId: item.project_id, itemId, userId: user.id, productId: selection.productId, isPrimary: true, selectedPriceSourceId, reason });
      await runCalculation({ selectedPriceSourceId });
    }
  } else if (body.kind === "CONFIRM_EXCHANGE_RATE") {
    const rate = Number(body.rate); const from = String(body.from || "").trim(); const to = String(body.to || "").trim() || scenario.project_currency; const validUntil = String(body.validUntil || "").slice(0, 10);
    if (!Number.isFinite(rate) || rate <= 0 || !from || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return json({ error: { code: "COST_ANSWER_EXCHANGE_RATE_INVALID", message: "A positive rate, source currency, and an explicit valid-until date are required." } }, 422);
    const rateId = id("fxrate"), stamp = now();
    const previous = await env.DB.prepare("SELECT id, version_number FROM pricing_exchange_rates WHERE project_id=? AND from_currency=? AND to_currency=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(item.project_id, from, to).first();
    await env.DB.batch([
      ...(previous ? [env.DB.prepare("UPDATE pricing_exchange_rates SET superseded_at=? WHERE id=?").bind(stamp, previous.id)] : []),
      env.DB.prepare("INSERT INTO pricing_exchange_rates (id, project_id, from_currency, to_currency, rate, rate_type, source, effective_from, valid_until, version_number, approval_status, approved_by, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved', ?, ?)").bind(rateId, item.project_id, from, to, String(rate), "Engineer Confirmed", reason, stamp, validUntil, Number(previous?.version_number || 0) + 1, user.id, user.id),
    ]);
    await runCalculation({});
  } else if (body.kind === "ADD_COST_COMPONENT") {
    const type = String(body.type || "").trim();
    const method = String(body.method || "").trim();
    const rate = Number(body.rate);
    if (!type || !["Fixed", "Per Item", "Percentage of Material", "Percentage of Direct Cost", "Hours"].includes(method) || !Number.isFinite(rate)) return json({ error: { code: "COST_ANSWER_COMPONENT_INVALID", message: "A cost category, a supported basis method, and an explicit rate are required." } }, 422);
    await runCalculation({ costComponents: [{ type, method, rate, description: body.description || type, quantity: body.quantity }] });
  } else {
    return json({ error: { code: "COST_ANSWER_KIND_INVALID", message: "Use SELECT_PRICE_SOURCE, CONFIRM_EXCHANGE_RATE, or ADD_COST_COMPONENT." } }, 422);
  }

  const model = await buildLineCostModel(env, { itemId, userId: user.id });
  return json({ decision: { kind: body.kind, reason }, model });
}
