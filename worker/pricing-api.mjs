import {
  aggregateProjectPricing,
  calculatePricingLine,
  PRICING_ENGINE_VERSION,
  PRICING_RULESET_VERSION,
  validateManualPriceInput,
} from "../app/domain/pricing-engine.mjs";
import { commercialLineTotals } from "../app/domain/commercial-summary.mjs";
import { resolveApplicationContext } from "./application-context.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
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
const roleFor = async (db, projectId, userId) => {
  const project = await db
    .prepare("SELECT owner_user_id FROM projects WHERE id=?")
    .bind(projectId)
    .first();
  if (!project) return null;
  if (project.owner_user_id === userId) return "Admin";
  const member = await db
    .prepare(
      "SELECT role FROM project_members WHERE project_id=? AND user_id=? AND status='Active' AND revoked_at IS NULL",
    )
    .bind(projectId, userId)
    .first();
  return member?.role || null;
};
const requireRole = async (db, projectId, userId, roles) => {
  const role = await roleFor(db, projectId, userId);
  return role && roles.includes(role) ? role : null;
};
const ownedProject = (db, projectId, userId) =>
  db
    .prepare(
      "SELECT p.* FROM projects p WHERE p.id=? AND (p.owner_user_id=? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL))",
    )
    .bind(projectId, userId, userId)
    .first();
const currentLine = (db, boqItemId, scenarioId) =>
  db
    .prepare(
      "SELECT l.*, r.version_number run_version, r.scenario_id, r.input_fingerprint, r.locked_versions, r.created_by, r.created_at run_created_at FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id WHERE l.boq_item_id=? AND r.scenario_id=? AND r.superseded_at IS NULL ORDER BY r.version_number DESC LIMIT 1",
    )
    .bind(boqItemId, scenarioId)
    .first();
const lineOutput = (row) =>
  row
    ? {
        ...row,
        output: parse(row.output, {}),
        locked_versions: parse(row.locked_versions, {}),
      }
    : null;

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

const persistRun = async (
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
        JSON.stringify(input.versions),
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

export const handlePricingApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/pricing")) return null;
  if (!env.DB)
    return json(
      {
        error: {
          code: "PRICING_STORAGE_UNAVAILABLE",
          message: "Pricing storage is unavailable.",
        },
      },
      503,
    );
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error)
    return json({ error: resolved.error }, resolved.error.status);
  const userId = resolved.context.userId;
  const selectedScenarioRoute = url.pathname.match(
    /^\/api\/pricing\/projects\/([^/]+)\/selected-scenario$/,
  );
  if (selectedScenarioRoute && request.method === "POST") {
    const projectId = decodeURIComponent(selectedScenarioRoute[1]);
    if (!(await ownedProject(env.DB, projectId, userId)))
      return json(
        { error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } },
        404,
      );

    const role = await requireRole(env.DB, projectId, userId, [
      "Admin",
      "Project Manager",
      "Commercial Approver",
      "Management",
    ]);
    if (!role)
      return json(
        {
          error: {
            code: "PRICING_SCENARIO_SELECTION_PERMISSION_REQUIRED",
            message:
              "Project Manager or commercial approval permission is required to select the quotation pricing scenario.",
          },
        },
        403,
      );

    const body = await request.json();
    const scenarioId = String(body.scenarioId || "").trim();
    const reason = String(body.reason || "").trim();

    if (!scenarioId)
      return json(
        {
          error: {
            code: "PRICING_SCENARIO_REQUIRED",
            message: "Select a pricing scenario.",
          },
        },
        422,
      );

    if (reason.length < 10)
      return json(
        {
          error: {
            code: "PRICING_SCENARIO_SELECTION_REASON_REQUIRED",
            message:
              "Provide a substantive reason for selecting this scenario for quotation.",
          },
        },
        422,
      );

    const scenario = await env.DB
      .prepare(
        "SELECT id,name,mode,version_number,project_currency,status FROM pricing_scenarios WHERE id=? AND project_id=? AND deleted_at IS NULL AND superseded_at IS NULL",
      )
      .bind(scenarioId, projectId)
      .first();

    if (!scenario)
      return json(
        {
          error: {
            code: "PRICING_SCENARIO_NOT_AVAILABLE",
            message:
              "The selected pricing scenario is not a current scenario for this project.",
          },
        },
        409,
      );

    const profile = await env.DB
      .prepare(
        "SELECT selected_pricing_scenario_id FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL",
      )
      .bind(projectId)
      .first();

    if (!profile)
      return json(
        {
          error: {
            code: "PROJECT_PROFILE_NOT_FOUND",
            message: "The durable project profile is unavailable.",
          },
        },
        409,
      );

    const previousScenarioId = profile.selected_pricing_scenario_id || null;
    const selectedAt = now();

    await env.DB.batch([
      env.DB
        .prepare(
          "UPDATE project_dashboard_profiles SET selected_pricing_scenario_id=?, selected_pricing_scenario_at=?, selected_pricing_scenario_by=?, selected_pricing_scenario_reason=?, updated_by=?, updated_at=? WHERE project_id=? AND deleted_at IS NULL",
        )
        .bind(
          scenarioId,
          selectedAt,
          userId,
          reason,
          userId,
          selectedAt,
          projectId,
        ),
      env.DB
        .prepare(
          "INSERT INTO dashboard_audit_log (id,project_id,action,previous_value,new_value,reason,actor_user_id,actor_role,request_id) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id("dashboardaudit"),
          projectId,
          "Pricing Scenario Selected for Quotation",
          JSON.stringify({ scenarioId: previousScenarioId }),
          JSON.stringify({
            scenarioId,
            scenarioName: scenario.name,
            scenarioVersion: scenario.version_number,
          }),
          reason,
          userId,
          role,
          request.headers.get("x-request-id") || id("request"),
        ),
    ]);

    return json({
      projectId,
      selectedScenario: {
        id: scenario.id,
        name: scenario.name,
        mode: scenario.mode,
        versionNumber: scenario.version_number,
        currency: scenario.project_currency,
        status: scenario.status,
      },
      selectedAt,
      selectedBy: userId,
      reason,
    });
  }

  const commercialSummaryRoute = url.pathname.match(
    /^\/api\/pricing\/projects\/([^/]+)\/commercial-summary$/,
  );
  if (commercialSummaryRoute && request.method === "GET") {
    const projectId = decodeURIComponent(commercialSummaryRoute[1]);
    if (!(await ownedProject(env.DB, projectId, userId)))
      return json(
        { error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } },
        404,
      );
    const requestedScenarioId = url.searchParams.get("scenarioId");
    const authority = await env.DB
      .prepare(
        "SELECT selected_pricing_scenario_id FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL",
      )
      .bind(projectId)
      .first();
    const selectedScenarioId = authority?.selected_pricing_scenario_id || null;
    const scenarioId = requestedScenarioId || selectedScenarioId || null;
    const scenarioCurrency = scenarioId
      ? await env.DB
          .prepare(
            "SELECT project_currency FROM pricing_scenarios WHERE id=? AND project_id=? AND deleted_at IS NULL AND superseded_at IS NULL",
          )
          .bind(scenarioId, projectId)
          .first()
      : null;

    if (scenarioId && !scenarioCurrency)
      return json(
        {
          error: {
            code: "PRICING_SCENARIO_NOT_AVAILABLE",
            message: "The requested pricing scenario is no longer current.",
          },
        },
        409,
      );
    const dashboardProfile = await env.DB
      .prepare(
        "SELECT currency FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL",
      )
      .bind(projectId)
      .first();
    const result = scenarioId
      ? await env.DB
          .prepare(
            `SELECT l.*, r.completed_at, r.created_at run_created_at,
CASE WHEN (
  SELECT a.status
  FROM pricing_approvals a
  WHERE a.pricing_run_id=r.id
    AND a.approval_type='Commercial Price'
  ORDER BY COALESCE(a.decided_at,a.created_at) DESC,
           a.created_at DESC,
           a.id DESC
  LIMIT 1
)='Approved' THEN 1 ELSE 0 END commercially_approved
FROM pricing_lines l
JOIN pricing_runs r ON r.id=l.pricing_run_id
JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id
WHERE r.project_id=?
  AND r.scenario_id=?
  AND ${currentBoqItemPredicate("b")}
  AND r.superseded_at IS NULL
  AND r.version_number=(
    SELECT MAX(r2.version_number)
    FROM pricing_runs r2
    JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id
    WHERE r2.scenario_id=r.scenario_id
      AND r2.superseded_at IS NULL
      AND l2.boq_item_id=l.boq_item_id
  )`,
          )
          .bind(projectId, scenarioId)
          .all()
      : { results: [] };
    const lines = result.results || [];
    const currency =
      lines[0]?.project_currency ||
      scenarioCurrency?.project_currency ||
      dashboardProfile?.currency ||
      "SAR";
    const latestTimestamp = lines.reduce((latest, line) => {
      const timestamp = String(line.completed_at || line.run_created_at || "");
      return timestamp > latest ? timestamp : latest;
    }, "");
    const lineTotals = commercialLineTotals(
      lines,
      currency,
      latestTimestamp || null,
    );
    const quotation = await env.DB
      .prepare(
        "SELECT id,revision_number,currency,total_minor,status,source_summary_json,approved_at,issued_at,created_at FROM project_quotation_revisions WHERE project_id=? AND status IN ('Approved','Issued') AND superseded_at IS NULL ORDER BY revision_number DESC LIMIT 1",
      )
      .bind(projectId)
      .first();
    const quotationSource = parse(quotation?.source_summary_json, {});
    return json({
      projectId,
      scenarioId,
      selectedScenarioId,
      authoritative: Boolean(
        scenarioId && selectedScenarioId && scenarioId === selectedScenarioId,
      ),
      commercialSummary: {
        ...lineTotals,
        quotationApproved: quotation
          ? {
              amountMinor: Number(quotation.total_minor || 0),
              amount: Number(quotation.total_minor || 0) / 100,
              currency: quotation.currency,
              includedLineCount: Number(quotationSource.pricingLineCount || 0),
              excludedLineCount: 0,
              state: quotation.status,
              calculationVersion: `quotation-r${quotation.revision_number}`,
              calculatedAt:
                quotation.issued_at || quotation.approved_at || quotation.created_at,
            }
          : {
              amountMinor: 0,
              amount: 0,
              currency,
              includedLineCount: 0,
              excludedLineCount: lines.length,
              state: "Not Approved",
              calculationVersion: null,
              calculatedAt: null,
            },
      },
      versionTimestamp: latestTimestamp || null,
    });
  }

  const projectOperationRoute = url.pathname.match(
    /^\/api\/pricing\/projects\/([^/]+)\/(exchange-rates|summary|history)$/,
  );
  if (projectOperationRoute) {
    const projectId = decodeURIComponent(projectOperationRoute[1]),
      operation = projectOperationRoute[2];
    if (!(await ownedProject(env.DB, projectId, userId)))
      return json(
        { error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } },
        404,
      );
    if (operation === "exchange-rates" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT * FROM pricing_exchange_rates WHERE project_id=? ORDER BY created_at DESC",
      )
        .bind(projectId)
        .all();
      return json({ exchangeRates: rows.results || [] });
    }
    if (operation === "exchange-rates" && request.method === "POST") {
      const role = await requireRole(env.DB, projectId, userId, [
        "Commercial Manager",
        "Admin",
      ]);
      if (!role)
        return json(
          {
            error: {
              code: "EXCHANGE_RATE_APPROVAL_ROLE_REQUIRED",
              message:
                "Commercial Manager approval is required for exchange rates.",
            },
          },
          403,
        );
      const body = await request.json(),
        required = [
          "fromCurrency",
          "toCurrency",
          "rate",
          "source",
          "effectiveFrom",
          "validUntil",
        ].filter((field) => !body[field]);
      if (
        required.length ||
        Number(body.rate) <= 0 ||
        new Date(body.validUntil) < new Date()
      )
        return json(
          {
            error: {
              code: "INVALID_EXCHANGE_RATE",
              message:
                "A positive, sourced and current exchange rate is required.",
              missing: required,
            },
          },
          422,
        );
      const previous = await env.DB.prepare(
          "SELECT * FROM pricing_exchange_rates WHERE project_id=? AND from_currency=? AND to_currency=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
        )
          .bind(projectId, body.fromCurrency, body.toCurrency)
          .first(),
        rateId = id("rate"),
        version = Number(previous?.version_number || 0) + 1;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO pricing_exchange_rates (id, project_id, from_currency, to_currency, rate, rate_type, source, effective_from, valid_until, version_number, approval_status, approved_by, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved', ?, ?)",
        ).bind(
          rateId,
          projectId,
          body.fromCurrency,
          body.toCurrency,
          String(body.rate),
          body.rateType || "Project Fixed Rate",
          body.source,
          body.effectiveFrom,
          body.validUntil,
          version,
          userId,
          userId,
        ),
        ...(previous
          ? [
              env.DB.prepare(
                "UPDATE pricing_exchange_rates SET superseded_at=? WHERE id=?",
              ).bind(now(), previous.id),
            ]
          : []),
        env.DB.prepare(
          "INSERT INTO pricing_audit_events (id, project_id, action, previous_value, new_value, reason, actor_user_id, actor_role, request_id) VALUES (?, ?, 'Exchange Rate Approved', ?, ?, ?, ?, ?, ?)",
        ).bind(
          id("pricingaudit"),
          projectId,
          JSON.stringify(previous),
          JSON.stringify({
            rateId,
            version,
            from: body.fromCurrency,
            to: body.toCurrency,
            rate: body.rate,
          }),
          String(
            body.reason || "Approved current project exchange-rate evidence",
          ),
          userId,
          role,
          id("request"),
        ),
      ]);
      return json({ rateId, version, status: "Approved" }, 201);
    }
    if (operation === "summary" && request.method === "GET") {
      const scenarioId = url.searchParams.get("scenarioId");
      if (!scenarioId)
        return json(
          {
            error: {
              code: "SCENARIO_REQUIRED",
              message: "Select a pricing scenario.",
            },
          },
          422,
        );
      const rows = await env.DB.prepare(
          `SELECT l.* FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id AND b.project_id=l.project_id WHERE r.project_id=? AND r.scenario_id=? AND ${currentBoqItemPredicate("b")} AND r.superseded_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=r.scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id)`,
        )
          .bind(projectId, scenarioId)
          .all(),
        lines = (rows.results || []).map((row) => ({
          approvalReady: Boolean(row.approval_ready),
          materialTotal: Number(row.material_total_minor || 0) / 100,
          totalCost: Number(row.total_cost_minor || 0) / 100,
          grossSelling: Number(row.gross_selling_minor || 0) / 100,
          customerDiscount: Number(row.customer_discount_minor || 0) / 100,
          netSelling: Number(row.net_selling_minor || 0) / 100,
          vat: Number(row.vat_minor || 0) / 100,
          finalValue: Number(row.final_value_minor || 0) / 100,
        }));
      return json({
        status: lines.length ? "Calculated" : "Not Started",
        summary: aggregateProjectPricing(lines),
      });
    }
    if (operation === "history" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, scenario_id, version_number, status, reason, locked_versions, summary, created_by, created_at, completed_at, superseded_at FROM pricing_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 500",
      )
        .bind(projectId)
        .all();
      return json({
        history: (rows.results || []).map((row) => ({
          ...row,
          locked_versions: parse(row.locked_versions, {}),
          summary: parse(row.summary, {}),
        })),
      });
    }
  }
  const scenarioRoute = url.pathname.match(
    /^\/api\/pricing\/projects\/([^/]+)\/scenarios(?:\/(compare))?$/,
  );
  if (scenarioRoute) {
    const projectId = decodeURIComponent(scenarioRoute[1]),
      project = await ownedProject(env.DB, projectId, userId);
    if (!project)
      return json(
        { error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } },
        404,
      );
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT * FROM pricing_scenarios WHERE project_id=? AND deleted_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC",
      )
        .bind(projectId)
        .all();
      return json({
        scenarios: (rows.results || []).map((row) => ({
          ...row,
          assumptions: parse(row.assumptions, []),
          settings: parse(row.settings, {}),
        })),
      });
    }
    if (!scenarioRoute[2] && request.method === "POST") {
      const role = await requireRole(env.DB, projectId, userId, [
        "Estimator",
        "Commercial Manager",
        "Admin",
      ]);
      if (!role)
        return json(
          {
            error: {
              code: "PRICING_ROLE_REQUIRED",
              message: "Your project role cannot create pricing scenarios.",
            },
          },
          403,
        );
      const body = await request.json(),
        name = String(body.name || "").trim();
      if (!name || !body.projectCurrency)
        return json(
          {
            error: {
              code: "SCENARIO_FIELDS_REQUIRED",
              message: "Scenario name and project currency are required.",
            },
          },
          422,
        );
      const latest = await env.DB.prepare(
          "SELECT MAX(version_number) maximum FROM pricing_scenarios WHERE project_id=? AND name=?",
        )
          .bind(projectId, name)
          .first(),
        scenarioId = id("scenario");
      await env.DB.prepare(
        "INSERT INTO pricing_scenarios (id, project_id, name, mode, version_number, project_currency, status, assumptions, settings, created_by) VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?)",
      )
        .bind(
          scenarioId,
          projectId,
          name,
          body.mode || "Base Case",
          Number(latest?.maximum || 0) + 1,
          body.projectCurrency,
          JSON.stringify(body.assumptions || []),
          JSON.stringify(body.settings || {}),
          userId,
        )
        .run();
      return json({ scenarioId, status: "Draft" }, 201);
    }
    if (scenarioRoute[2] === "compare" && request.method === "POST") {
      const body = await request.json(),
        ids = Array.isArray(body.scenarioIds)
          ? body.scenarioIds.slice(0, 5)
          : [];
      if (ids.length < 2)
        return json(
          {
            error: {
              code: "SCENARIOS_REQUIRED",
              message: "Select at least two scenarios.",
            },
          },
          422,
        );
      const placeholders = ids.map(() => "?").join(",");
      const scenarios = await env.DB.prepare(
        `SELECT id, name, mode, project_currency FROM pricing_scenarios WHERE project_id=? AND deleted_at IS NULL AND id IN (${placeholders})`,
      )
        .bind(projectId, ...ids)
        .all();

      const comparison = [];
      for (const scenario of scenarios.results || []) {
        const rows = await env.DB.prepare(
          `SELECT l.* FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id WHERE r.project_id=? AND r.scenario_id=? AND r.superseded_at IS NULL AND ${currentBoqItemPredicate("b")} AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=r.scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id)`,
        )
          .bind(projectId, scenario.id)
          .all();

        const lines = (rows.results || []).map((row) => ({
          approvalReady: Boolean(row.approval_ready),
          materialTotal: Number(row.material_total_minor || 0) / 100,
          totalCost: Number(row.total_cost_minor || 0) / 100,
          grossSelling: Number(row.gross_selling_minor || 0) / 100,
          customerDiscount: Number(row.customer_discount_minor || 0) / 100,
          netSelling: Number(row.net_selling_minor || 0) / 100,
          vat: Number(row.vat_minor || 0) / 100,
          finalValue: Number(row.final_value_minor || 0) / 100,
        }));

        comparison.push({
          ...scenario,
          summary: aggregateProjectPricing(lines),
        });
      }

      return json({ comparison });
    }
  }
  const itemRoute = url.pathname.match(
    /^\/api\/pricing\/items\/([^/]+)(?:\/(calculate|recalculate|breakdown|history|sources|manual-price))?$/,
  );
  if (itemRoute) {
    const boqItemId = decodeURIComponent(itemRoute[1]),
      item = await env.DB.prepare(
        `SELECT b.* FROM ${currentBoqEvidenceFrom("b")} WHERE b.id=? AND ${currentBoqItemPredicate("b")}`
      )
        .bind(boqItemId)
        .first();
    if (!item || !(await ownedProject(env.DB, item.project_id, userId)))
      return json(
        {
          error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." },
        },
        404,
      );
    const operation = itemRoute[2] || "breakdown";
    if (
      ["calculate", "recalculate"].includes(operation) &&
      request.method === "POST"
    ) {
      const role = await requireRole(env.DB, item.project_id, userId, [
        "Estimator",
        "Commercial Manager",
        "Admin",
      ]);
      if (!role)
        return json(
          {
            error: {
              code: "PRICING_ROLE_REQUIRED",
              message: "Your project role cannot calculate pricing.",
            },
          },
          403,
        );
      const body = await request.json(),
        scenario = await env.DB.prepare(
          "SELECT * FROM pricing_scenarios WHERE id=? AND project_id=? AND deleted_at IS NULL AND superseded_at IS NULL",
        )
          .bind(String(body.scenarioId || ""), item.project_id)
          .first();
      if (!scenario)
        return json(
          {
            error: {
              code: "SCENARIO_NOT_FOUND",
              message: "Pricing scenario not found.",
            },
          },
          404,
        );
      try {
        const input = await loadPricingInput(env.DB, {
            projectId: item.project_id,
            boqItemId,
            candidateId: String(body.candidateId || ""),
            scenario,
            body,
          }),
          result = calculatePricingLine(input),
          persisted = await persistRun(env.DB, {
            projectId: item.project_id,
            scenario,
            boqItemId,
            candidateId: input.candidateId,
            input,
            result,
            userId,
            role,
            reason: String(
              body.reason ||
                (operation === "recalculate"
                  ? "Pricing recalculation"
                  : "Initial pricing calculation"),
            ),
          });
        return json(persisted, 201);
      } catch (error) {
        return json(
          {
            error: {
              code: error.code || "PRICING_CALCULATION_FAILED",
              message: error.message,
              affectedItem: boqItemId,
              suggestedAction: "Review the pricing preconditions and retry.",
            },
          },
          422,
        );
      }
    }
    const scenarioId = url.searchParams.get("scenarioId");
    if (!scenarioId)
      return json(
        {
          error: {
            code: "SCENARIO_REQUIRED",
            message: "Select a pricing scenario.",
          },
        },
        422,
      );

    if (operation !== "history") {
      const currentScenario = await env.DB.prepare(
        "SELECT id FROM pricing_scenarios WHERE id=? AND project_id=? AND deleted_at IS NULL AND superseded_at IS NULL"
      )
        .bind(scenarioId, item.project_id)
        .first();

      if (!currentScenario)
        return json(
          {
            error: {
              code: "SCENARIO_NOT_FOUND",
              message: "Pricing scenario not found.",
            },
          },
          404,
        );
    }

    const current = await currentLine(env.DB, boqItemId, scenarioId);
    if (operation === "breakdown" && request.method === "GET") {
      if (!current) return json({ status: "Not Started" });
      const [components, discounts] = await Promise.all([
        env.DB.prepare(
          "SELECT * FROM pricing_cost_components WHERE pricing_line_id=? ORDER BY component_type",
        )
          .bind(current.id)
          .all(),
        env.DB.prepare(
          "SELECT * FROM pricing_discount_applications WHERE pricing_line_id=? ORDER BY order_number",
        )
          .bind(current.id)
          .all(),
      ]);
      return json({
        line: lineOutput(current),
        components: components.results || [],
        discounts: discounts.results || [],
      });
    }
    if (operation === "history" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT l.id, l.status, l.total_cost_minor, l.net_selling_minor, l.final_value_minor, l.margin_basis_points, r.id run_id, r.version_number, r.reason, r.created_by, r.created_at, r.superseded_at FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id WHERE l.boq_item_id=? AND r.scenario_id=? ORDER BY r.version_number DESC",
      )
        .bind(boqItemId, scenarioId)
        .all();
      return json({ history: rows.results || [] });
    }
    if (operation === "sources" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT r.*, s.name supplier_name FROM price_records r LEFT JOIN suppliers s ON s.id=r.supplier_id JOIN pricing_lines l ON l.product_id=r.product_id WHERE l.boq_item_id=? AND l.pricing_run_id=(SELECT pr.id FROM pricing_runs pr JOIN pricing_lines pl ON pl.pricing_run_id=pr.id WHERE pr.scenario_id=? AND pr.superseded_at IS NULL AND pl.boq_item_id=? ORDER BY pr.version_number DESC LIMIT 1)",
      )
        .bind(boqItemId, scenarioId, boqItemId)
        .all();
      return json({ sources: rows.results || [] });
    }
    if (operation === "manual-price" && request.method === "POST") {
      const role = await roleFor(env.DB, item.project_id, userId),
        body = await request.json(),
        technical = await env.DB.prepare(
          "SELECT a.status, d.candidate_id, c.product_id FROM safety_approval_requests a JOIN safety_decisions d ON d.id=a.safety_decision_id AND d.superseded_at IS NULL JOIN product_match_candidates c ON c.id=d.candidate_id JOIN product_match_runs r ON r.id=c.match_run_id WHERE d.candidate_id=? AND r.project_id=? AND r.boq_item_id=? AND r.superseded_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM product_match_runs r2 WHERE r2.boq_item_id=r.boq_item_id AND r2.superseded_at IS NULL) AND a.approval_type='Technical' ORDER BY a.decided_at DESC, a.id DESC LIMIT 1",
        )
          .bind(String(body.candidateId || ""), item.project_id, boqItemId)
          .first(),
        validation = validateManualPriceInput({
          input: { ...body, projectId: item.project_id, boqItemId },
          user: { id: userId, role },
          technicalApproval: technical
            ? { status: technical.status, candidateId: technical.candidate_id }
            : null,
        });
      if (!validation.permitted || technical?.product_id !== body.productId)
        return json(
          {
            error: {
              code: "MANUAL_PRICE_NOT_PERMITTED",
              message:
                "Manual price requirements are incomplete or the product does not match the approved candidate.",
              validation,
            },
          },
          422,
        );
      const sourceId = id("manualsource"),
        priceId = id("price"),
        checksum = await hash({
          projectId: item.project_id,
          boqItemId,
          candidateId: body.candidateId,
          productId: body.productId,
          source: body.source,
          validUntil: body.validUntil,
          price: body.price,
          currency: body.currency,
          reason: body.reason,
        }),
        created = now();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO product_sources (id,project_id,checksum,source_type,authority,scope_type,file_name,effective_from,valid_until,currency,validity_state,review_status,downstream_use,metadata,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          sourceId,
          item.project_id,
          checksum,
          "Manual Price Evidence",
          "Estimator Submitted",
          "Project",
          String(body.source),
          body.effectiveFrom || created,
          body.validUntil,
          body.currency,
          "Valid",
          "Needs Review",
          "Discovery Only",
          JSON.stringify({
            boqItemId,
            candidateId: body.candidateId,
            scope: body.scope,
            reason: body.reason,
          }),
          userId,
          created,
        ),
        env.DB.prepare(
          "INSERT INTO price_records (id,product_id,source_id,project_id,amount_minor,currency,price_type,unit,effective_from,valid_until,validity_state,approval_status,downstream_use,terms,source_location,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          priceId,
          body.productId,
          sourceId,
          item.project_id,
          Math.round(Number(body.price) * 100),
          body.currency,
          "Manual Verified Price",
          body.unit || item.normalized_unit || "EA",
          body.effectiveFrom || created,
          body.validUntil,
          "Valid",
          "Needs Review",
          "Discovery Only",
          JSON.stringify({ scope: body.scope }),
          JSON.stringify({
            boqItemId,
            candidateId: body.candidateId,
            source: body.source,
          }),
          created,
        ),
        env.DB.prepare(
          "INSERT INTO pricing_audit_events (id,project_id,action,new_value,reason,actor_user_id,actor_role,request_id) VALUES (?,?, 'Manual Price Submitted',?,?,?,?,?)",
        ).bind(
          id("pricingaudit"),
          item.project_id,
          JSON.stringify({
            priceId,
            sourceId,
            status: "Needs Review",
            downstreamUse: "Discovery Only",
          }),
          String(body.reason),
          userId,
          role,
          id("request"),
        ),
      ]);
      return json(
        {
          status: "Persisted — Needs Review",
          classification: validation.classification,
          priceId,
          sourceId,
          approvalStatus: "Needs Review",
          downstreamUse: "Discovery Only",
          auditRequired: true,
        },
        201,
      );
    }
  }
  const runRoute = url.pathname.match(
    /^\/api\/pricing\/runs\/([^/]+)(?:\/(approve|reject|summary|compare|export))?$/,
  );
  if (runRoute) {
    const run = await env.DB.prepare("SELECT * FROM pricing_runs WHERE id=?")
      .bind(decodeURIComponent(runRoute[1]))
      .first();
    if (!run || !(await ownedProject(env.DB, run.project_id, userId)))
      return json(
        {
          error: {
            code: "PRICING_RUN_NOT_FOUND",
            message: "Pricing run not found.",
          },
        },
        404,
      );
    const operation = runRoute[2] || "summary";
    if (operation === "summary" && request.method === "GET")
      return json({
        run: {
          ...run,
          summary: parse(run.summary, {}),
          lockedVersions: parse(run.locked_versions, {}),
        },
      });
    if (operation === "export" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT boq_item_id, status, quantity, unit, source_currency, project_currency, original_list_price_minor, net_material_unit_minor, material_total_minor, total_cost_minor, net_selling_minor, vat_minor, final_value_minor, margin_basis_points, markup_basis_points, explanation FROM pricing_lines WHERE pricing_run_id=? ORDER BY created_at",
      )
        .bind(run.id)
        .all();
      const headers = [
          "BOQ Item",
          "Status",
          "Quantity",
          "Unit",
          "Source Currency",
          "Project Currency",
          "List Price",
          "Net Material Unit",
          "Material Total",
          "Total Cost",
          "Net Selling",
          "VAT",
          "Final Value",
          "Margin %",
          "Markup %",
          "Explanation",
        ],
        escaped = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`,
        body = [
          headers,
          ...(rows.results || []).map((row) => [
            row.boq_item_id,
            row.status,
            row.quantity,
            row.unit,
            row.source_currency,
            row.project_currency,
            row.original_list_price_minor == null
              ? ""
              : row.original_list_price_minor / 100,
            row.net_material_unit_minor == null
              ? ""
              : row.net_material_unit_minor / 100,
            row.material_total_minor == null
              ? ""
              : row.material_total_minor / 100,
            row.total_cost_minor == null ? "" : row.total_cost_minor / 100,
            row.net_selling_minor == null ? "" : row.net_selling_minor / 100,
            row.vat_minor == null ? "" : row.vat_minor / 100,
            row.final_value_minor == null ? "" : row.final_value_minor / 100,
            row.margin_basis_points == null
              ? ""
              : row.margin_basis_points / 100,
            row.markup_basis_points == null
              ? ""
              : row.markup_basis_points / 100,
            row.explanation,
          ]),
        ]
          .map((row) => row.map(escaped).join(","))
          .join("\r\n");
      return new Response(body, {
        headers: {
          "content-type": "text/csv;charset=utf-8",
          "content-disposition": `attachment; filename="pricing-run-${run.version_number}.csv"`,
        },
      });
    }
    if (operation === "compare" && request.method === "POST") {
      const body = await request.json(),
        previous = await env.DB.prepare(
          "SELECT * FROM pricing_runs WHERE id=? AND project_id=?",
        )
          .bind(String(body.previousRunId || ""), run.project_id)
          .first();
      if (!previous)
        return json(
          {
            error: {
              code: "PREVIOUS_PRICING_RUN_NOT_FOUND",
              message: "Previous pricing run not found.",
            },
          },
          404,
        );
      const before = parse(previous.summary, {}),
        after = parse(run.summary, {}),
        changes = Object.fromEntries(
          [...new Set([...Object.keys(before), ...Object.keys(after)])]
            .filter((key) => before[key] !== after[key])
            .map((key) => [key, [before[key], after[key]]]),
        );
      const comparisonId = id("pricingcomparison");
      await env.DB.prepare(
        "INSERT OR REPLACE INTO pricing_run_comparisons (id, project_id, previous_run_id, current_run_id, changes, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          comparisonId,
          run.project_id,
          previous.id,
          run.id,
          JSON.stringify(changes),
          userId,
        )
        .run();
      return json({ comparison: { id: comparisonId, changes } });
    }
    if (
      ["approve", "reject"].includes(operation) &&
      request.method === "POST"
    ) {
      if (run.superseded_at)
        return json(
          {
            error: {
              code: "PRICING_RUN_NOT_FOUND",
              message: "Pricing run not found.",
            },
          },
          404,
        );

      const currentScenario = await env.DB.prepare(
        "SELECT id FROM pricing_scenarios WHERE id=? AND project_id=? AND deleted_at IS NULL AND superseded_at IS NULL"
      )
        .bind(run.scenario_id, run.project_id)
        .first();

      if (!currentScenario)
        return json(
          {
            error: {
              code: "PRICING_SCENARIO_NOT_AVAILABLE",
              message: "The pricing run belongs to a scenario that is no longer current.",
            },
          },
          409,
        );

      const staleLine = await env.DB.prepare(
        `SELECT l.boq_item_id
         FROM pricing_lines l
         WHERE l.pricing_run_id=?
           AND EXISTS (
             SELECT 1
             FROM pricing_runs r2
             JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id
             WHERE r2.scenario_id=?
               AND r2.superseded_at IS NULL
               AND l2.boq_item_id=l.boq_item_id
               AND r2.version_number>?
           )
         LIMIT 1`
      )
        .bind(run.id, run.scenario_id, run.version_number)
        .first();

      if (staleLine)
        return json(
          {
            error: {
              code: "STALE_PRICING_RUN",
              message: "A newer current pricing run exists for one or more BOQ items.",
            },
          },
          409,
        );

      const role = await requireRole(env.DB, run.project_id, userId, [
        "Commercial Manager",
        "Admin",
      ]);
      if (!role)
        return json(
          {
            error: {
              code: "COMMERCIAL_APPROVAL_ROLE_REQUIRED",
              message: "Commercial Manager approval is required.",
            },
          },
          403,
        );
      const body = await request.json(),
        reason = String(body.reason || "").trim();
      if (Number(body.entityVersion) !== Number(run.version_number))
        return json(
          {
            error: {
              code: "STALE_PRICING_VERSION",
              message: "Pricing changed. Review the latest version.",
            },
          },
          409,
        );
      const lines = await env.DB.prepare(
        "SELECT * FROM pricing_lines WHERE pricing_run_id=?",
      )
        .bind(run.id)
        .all();
      if (
        operation === "approve" &&
        (lines.results || []).some(
          (line) =>
            !line.approval_ready ||
            !["Draft Price", "Needs Review"].includes(line.status),
        )
      )
        return json(
          {
            error: {
              code: "PRICING_APPROVAL_BLOCKED",
              message: "One or more pricing lines are not approval-ready.",
            },
          },
          409,
        );
      if (reason.length < 10)
        return json(
          {
            error: {
              code: "DECISION_REASON_REQUIRED",
              message: "Provide a substantive commercial decision reason.",
            },
          },
          422,
        );
      const approvalId = id("pricingapproval"),
        status = operation === "approve" ? "Approved" : "Rejected";
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO pricing_approvals (id, project_id, pricing_run_id, approval_type, status, entity_version, request_reason, evidence, requested_by, decided_by, decided_role, decision_reason, decided_at) VALUES (?, ?, ?, 'Commercial Price', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          approvalId,
          run.project_id,
          run.id,
          status,
          run.version_number,
          reason,
          JSON.stringify(body.evidence || {}),
          userId,
          userId,
          role,
          reason,
          now(),
        ),
        env.DB.prepare(
          "INSERT INTO pricing_audit_events (id, project_id, pricing_run_id, action, new_value, reason, actor_user_id, actor_role, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          id("pricingaudit"),
          run.project_id,
          run.id,
          `Pricing ${status}`,
          JSON.stringify({ approvalId, version: run.version_number }),
          reason,
          userId,
          role,
          id("request"),
        ),
      ]);
      return json({ approvalId, status });
    }
  }
  return json(
    {
      error: {
        code: "PRICING_API_NOT_FOUND",
        message: "Pricing operation not found.",
      },
    },
    404,
  );
};
