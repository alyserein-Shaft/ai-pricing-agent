import {
  aggregateProjectPricing,
  PRICING_ENGINE_VERSION,
  PRICING_RULESET_VERSION,
} from "../app/domain/pricing-engine.mjs";

import {
  currentBoqEvidenceFrom,
  currentBoqItemPredicate,
} from "./current-evidence-scope.mjs";

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const now = () => new Date().toISOString();

const parse = (value, fallback) => {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  )
    .map((entry) => entry.toString(16).padStart(2, "0"))
    .join("");

const moneyMinor = (value) =>
  value == null ? null : Math.round(Number(value) * 100);

export const loadPricingInput = async (
  db,
  { projectId, boqItemId, candidateId, scenario, body },
) => {
  const item = await db
    .prepare(`SELECT b.* FROM ${currentBoqEvidenceFrom("b")} WHERE b.id=? AND b.project_id=? AND ${currentBoqItemPredicate("b")}`)
    .bind(boqItemId, projectId)
    .first();
  if (!item)
    throw Object.assign(new Error("BOQ item not found."), {
      code: "BOQ_ITEM_NOT_FOUND",
    });
  const candidate = await db
    .prepare(
      "SELECT c.*, r.id match_run_id, r.version_number match_version, p.id product_id, p.part_number, p.lifecycle_status, m.name manufacturer FROM product_match_candidates c JOIN product_match_runs r ON r.id=c.match_run_id JOIN canonical_library_products p ON p.requested_product_id=c.product_id JOIN product_manufacturers m ON m.id=p.manufacturer_id WHERE c.id=? AND r.project_id=? AND r.boq_item_id=? AND r.superseded_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM product_match_runs r2 WHERE r2.boq_item_id=r.boq_item_id AND r2.superseded_at IS NULL)",
    )
    .bind(candidateId, projectId, boqItemId)
    .first();
  if (!candidate)
    throw Object.assign(new Error("Selected product candidate not found."), {
      code: "CANDIDATE_NOT_FOUND",
    });
  const safety = await db
    .prepare(
      "SELECT * FROM safety_decisions WHERE candidate_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
    .bind(candidateId)
    .first();
  if (!safety)
    throw Object.assign(
      new Error("Evaluate the current safety decision before pricing."),
      { code: "SAFETY_DECISION_REQUIRED" },
    );
  const technical = await db
    .prepare(
      "SELECT * FROM safety_approval_requests WHERE safety_decision_id=? AND approval_type='Technical' ORDER BY decided_at DESC, id DESC LIMIT 1",
    )
    .bind(safety.id)
    .first();
  const records = await db
    .prepare(
      "SELECT r.*, s.name supplier_name FROM price_records r LEFT JOIN suppliers s ON s.id=r.supplier_id WHERE r.product_id=? AND (r.project_id IS NULL OR r.project_id=?)",
    )
    .bind(candidate.product_id, projectId)
    .all();
  const rate = await db
    .prepare(
      "SELECT * FROM pricing_exchange_rates WHERE project_id=? AND approval_status='Approved' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
    .bind(projectId)
    .first();
  const settings = {
    ...parse(scenario.settings, {}),
    ...(body.settings || {}),
  };
  return {
    projectId,
    productId: candidate.product_id,
    candidateId,
    selectedPriceSourceId: body.selectedPriceSourceId || null,
    manufacturer: candidate.manufacturer,
    quantity: item.numeric_quantity,
    unit: item.normalized_unit,
    lumpSumMode: settings.lumpSumMode,
    region: settings.region,
    projectCurrency: scenario.project_currency,
    calculatedAt: now(),
    technicalApproval:
      technical?.status === "Approved"
        ? { status: technical.status, candidateId }
        : null,
    safetyDecision: safety
      ? {
          id: safety.id,
          version: safety.version_number,
          priceEligibility:
            technical?.status === "Approved" &&
            (records.results || []).some(
              (entry) =>
                entry.approval_status === "Approved" &&
                entry.downstream_use === "Costing" &&
                entry.valid_until &&
                new Date(entry.valid_until) >= new Date() &&
                entry.currency &&
                entry.source_id
            )
              ? "Eligible for Price Approval"
              : "Price Approval Disabled",
        }
      : null,
    priceSources: (records.results || []).map((entry) => ({
      id: entry.id,
      productId: entry.product_id,
      projectId: entry.project_id,
      amount: entry.amount_minor / 100,
      currency: entry.currency,
      priceType: entry.price_type,
      approvalStatus: entry.approval_status,
      downstreamUse: entry.downstream_use,
      effectiveFrom: entry.effective_from,
      validUntil: entry.valid_until,
      minimumQuantity: entry.minimum_quantity,
      reference: parse(entry.source_location, {}).reference || entry.id,
      supplier: entry.supplier_name,
      reliability: parse(entry.terms, {}).reliability,
    })),
    sourcePrecedence: settings.sourcePrecedence,
    exchangeRate: rate
      ? {
          from: rate.from_currency,
          to: rate.to_currency,
          rate: Number(rate.rate),
          source: rate.source,
          version: rate.version_number,
          approvalStatus: rate.approval_status,
          validUntil: rate.valid_until,
        }
      : null,
    discounts: body.discounts || settings.discounts || [],
    costComponents: body.costComponents || settings.costComponents || [],
    sellingRule: body.sellingRule ||
      settings.sellingRule || { method: "Markup", rate: 0, minimumMargin: 0 },
    customerDiscount: body.customerDiscount ||
      settings.customerDiscount || { percentage: 0 },
    vatRule: body.vatRule || settings.vatRule || { rate: 0 },
    precision: Number(settings.precision ?? 2),
    versions: {
      boqItem: item.updated_at,
      matchRun: candidate.match_version,
      safetyDecision: safety?.version_number || null,
      priceRecords: (records.results || []).map((entry) => [
        entry.id,
        entry.reviewed_at || entry.created_at,
      ]),
      exchangeRate: rate?.version_number || null,
      scenario: scenario.version_number,
    },
  };
};

export const persistRun = async (
  db,
  {
    projectId,
    scenario,
    boqItemId,
    candidateId,
    input,
    result,
    userId,
    role,
    reason,
  },
) => {
  const previous = await db
      .prepare(
        "SELECT * FROM pricing_runs WHERE scenario_id=? ORDER BY version_number DESC LIMIT 1",
      )
      .bind(scenario.id)
      .first(),
    version = Number(previous?.version_number || 0) + 1,
    runId = id("pricingrun"),
    lineId = id("pricingline"),
    fingerprint = await hash({
      input,
      engine: PRICING_ENGINE_VERSION,
      ruleset: PRICING_RULESET_VERSION,
    });
  const existing = await db
    .prepare(
      "SELECT r.id run_id, r.version_number, l.id line_id, l.status, l.output FROM pricing_runs r JOIN pricing_lines l ON l.pricing_run_id=r.id WHERE r.scenario_id=? AND l.boq_item_id=? AND r.input_fingerprint=? ORDER BY r.version_number DESC LIMIT 1",
    )
    .bind(scenario.id, boqItemId, fingerprint)
    .first();
  if (existing)
    return {
      runId: existing.run_id,
      lineId: existing.line_id,
      version: existing.version_number,
      status: existing.status,
      result: parse(existing.output, result),
      idempotent: true,
    };
  const statements = [
    db
      .prepare(
        "INSERT INTO pricing_runs (id, project_id, scenario_id, version_number, status, input_fingerprint, engine_version, ruleset_version, reason, locked_versions, summary, created_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        runId,
        projectId,
        scenario.id,
        version,
        result.status,
        fingerprint,
        PRICING_ENGINE_VERSION,
        PRICING_RULESET_VERSION,
        reason,
        JSON.stringify({
          ...(input.versions || {}),
          authoritativeCost: input.authoritativeCost || null,
        }),
        JSON.stringify(
          result.approvalReady
            ? aggregateProjectPricing([result])
            : { itemCount: 1, pricedItemCount: 0 },
        ),
        userId,
        now(),
      ),
  ];
  statements.push(
    db
      .prepare(
        "INSERT INTO pricing_lines (id, pricing_run_id, project_id, boq_item_id, candidate_id, product_id, safety_decision_id, selected_price_record_id, version_number, status, quantity, unit, source_currency, project_currency, original_list_price_minor, net_material_unit_minor, material_total_minor, direct_cost_minor, total_cost_minor, gross_selling_minor, customer_discount_minor, net_selling_minor, vat_minor, final_value_minor, margin_basis_points, markup_basis_points, output, explanation, approval_ready) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        lineId,
        runId,
        projectId,
        boqItemId,
        candidateId,
        input.productId,
        input.safetyDecision?.id || "",
        result.selectedSource?.id || null,
        version,
        result.status,
        String(input.quantity ?? ""),
        input.unit || "",
        result.selectedSource?.currency || null,
        input.projectCurrency,
        moneyMinor(result.originalListPrice),
        moneyMinor(result.netMaterialUnitCost),
        moneyMinor(result.materialTotal),
        moneyMinor(result.directCost),
        moneyMinor(result.totalCost),
        moneyMinor(result.grossSelling),
        moneyMinor(result.customerDiscount),
        moneyMinor(result.netSelling),
        moneyMinor(result.vat),
        moneyMinor(result.finalValue),
        result.margin == null ? null : Math.round(result.margin * 100),
        result.markup == null ? null : Math.round(result.markup * 100),
        JSON.stringify(result),
        result.explanation ||
          `Pricing blocked: ${(result.blockers || []).join(", ")}`,
        result.approvalReady ? 1 : 0,
      ),
  );
  for (const component of result.components || [])
    statements.push(
      db
        .prepare(
          "INSERT INTO pricing_cost_components (id, pricing_line_id, component_type, description, method, formula, rate, quantity, amount_minor, source, scope, assumptions, approval_status, rule_version, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id("costcomponent"),
          lineId,
          component.type || "Other",
          component.description || component.type || "Cost component",
          component.method,
          component.formula,
          String(component.rate ?? ""),
          String(component.quantity ?? ""),
          moneyMinor(component.calculatedAmount),
          JSON.stringify(component.source || {}),
          component.scope || "Line",
          JSON.stringify(component.assumptions || []),
          component.approvalStatus || "Needs Review",
          PRICING_RULESET_VERSION,
          userId,
        ),
    );
  for (const discount of result.discounts || [])
    statements.push(
      db
        .prepare(
          "INSERT INTO pricing_discount_applications (id, pricing_line_id, discount_type, mode, order_number, percentage_basis_points, calculation_base_minor, amount_minor, balance_minor, source, scope, valid_until, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id("discount"),
          lineId,
          discount.type || "Commercial Discount",
          discount.mode,
          Number(discount.order),
          Math.round(Number(discount.percentage) * 100),
          moneyMinor(discount.calculationBase),
          moneyMinor(discount.amount),
          moneyMinor(discount.balance),
          JSON.stringify(discount.source || { sourceId: discount.sourceId }),
          discount.scope || "Material",
          discount.validUntil,
          discount.approvedBy || userId,
        ),
    );
  statements.push(
    db
      .prepare(
        "INSERT INTO pricing_audit_events (id, project_id, pricing_run_id, pricing_line_id, action, previous_value, new_value, reason, actor_user_id, actor_role, request_id) VALUES (?, ?, ?, ?, 'Pricing Calculated', ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id("pricingaudit"),
        projectId,
        runId,
        lineId,
        JSON.stringify(
          previous
            ? { runId: previous.id, version: previous.version_number }
            : null,
        ),
        JSON.stringify({
          version,
          status: result.status,
          totalCost: result.totalCost,
          finalValue: result.finalValue,
        }),
        reason,
        userId,
        role,
        id("request"),
      ),
  );
  await db.batch(statements);
  return {
    runId,
    lineId,
    version,
    status: result.status,
    result,
    idempotent: false,
  };
};
