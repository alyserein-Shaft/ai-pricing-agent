// MVP-BOM-5, Phases 6-8 -- the SCOPE pricing input adapter.
//
// SCOPE pricing normalizes an engineering expansion requirement (resolved from
// the current COMPLETED panel-sizing snapshot) into the exact same
// calculatePricingLine input shape the PRODUCT path uses, so the single cost
// model prices it with byte-identical commercial math. Every authority gate
// that PRODUCT pricing depends on stays sourced from the same durable
// references; SCOPE only swaps which authority supplies the technical and
// evidence gates:
//
//   - technical authority   : current COMPLETED panel-sizing snapshot
//                             (fail closed when absent, non-COMPLETED, or
//                             content-unreadable) instead of the technical
//                             approval over a product match candidate;
//   - price evidence        : the same governed `price_records` (Approved +
//                             Costing, exact product_id) that PRODUCT pricing
//                             costs from -- no new price source;
//   - safety/eligibility    : not applicable to an engineered expansion
//                             requirement (no BOQ item, no match candidate, no
//                             safety decision), so SCOPE inputs carry
//                             `safetyDecision: null` and the engine's SCOPE
//                             branch re-keys the technical gate to the sizing
//                             snapshot authority.
//
// A pricing line for SCOPE is identified by its engineering requirement
// identity: engineering_scope_kind + system + source_product_id + source_role.
// The sizing snapshot version and fingerprint are persisted on the line
// (source_snapshot_id + source_fingerprint) so approval can prove the cost
// lock is still current.
import { priceValidity } from "../app/domain/pricing-engine.mjs";
import { resolvePriceValidityPolicy } from "./commercial-validity-policy.mjs";
import { isSourceVersionSuperseded, loadSupersededPriceSourceIds } from "./commercial-supersession.mjs";

export const SCOPE_KIND_PANEL_SIZING = "PANEL_SIZING_EXPANSION";
export const SCOPE_ROLE_LOOP_EXPANSION_UNIT = "LOOP_EXPANSION_UNIT";
export const SCOPE_ROLE_MOUNTING_UNIT = "MOUNTING_UNIT";

const parse = (value, fallback) => {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

const fail = (code, reason) => ({ ok: false, code, reason });

const currentSizingSnapshot = async (db, projectId) =>
  db
    .prepare(
      "SELECT * FROM fire_alarm_panel_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC LIMIT 1",
    )
    .bind(projectId)
    .first();

const addRequirement = (totals, role, productId, quantity) => {
  const key = `${role}|${productId}`;
  const current = totals.get(key);
  if (current) current.quantity += quantity;
  else totals.set(key, { role, productId, quantity });
};

/**
 * Derive the expansion-pricing requirements from the current COMPLETED
 * panel-sizing snapshot, keyed per (source_role, source_product_id).
 * Loop requirements come from `panel.requiredExpansionQuantity` per
 * loopExpansionUnit product; mounting requirements from
 * `mountingUnit.quantity` (falling back to the panel's required expansion
 * quantity) per mountingUnit product. The snapshot's id/version/fingerprint
 * are returned so callers can lock and re-check pricing freshness.
 */
export const resolveScopePricingRequirements = async (
  db,
  { projectId, system, engineeringScopeKind = SCOPE_KIND_PANEL_SIZING },
) => {
  if (!system || !String(system).trim())
    return fail("SCOPE_SYSTEM_REQUIRED", "The engineering scope system is required.");
  const snapshot = await currentSizingSnapshot(db, projectId);
  if (!snapshot)
    return fail("SCOPE_SNAPSHOT_REQUIRED", "No panel-sizing snapshot exists for the project.");
  if (snapshot.status !== "COMPLETED")
    return fail(
      "SCOPE_SNAPSHOT_NOT_COMPLETED",
      "The latest panel-sizing snapshot is not COMPLETED.",
    );
  const calculation = parse(snapshot.calculation_json, null);
  const sizing = calculation?.sizing;
  if (!sizing || sizing.status !== "AUTHORITATIVE_PANEL_SIZING")
    return fail(
      "SCOPE_CALCULATION_UNREADABLE",
      "The panel-sizing snapshot does not carry an authoritative panel-sizing result.",
    );
  const panels = Array.isArray(calculation?.panels) ? calculation.panels : [];
  const totals = new Map();
  for (const panel of panels) {
    const options = panel?.expansionOptions || {};
    const loopProductId = options.loopExpansionUnit?.productId;
    const loopQuantity = Number(panel.requiredExpansionQuantity || 0);
    if (loopProductId && loopQuantity > 0)
      addRequirement(totals, SCOPE_ROLE_LOOP_EXPANSION_UNIT, loopProductId, loopQuantity);
    const mountingProductId = options.mountingUnit?.productId;
    const mountingQuantity = Number(options.mountingUnit?.quantity ?? panel.requiredExpansionQuantity ?? 0);
    if (mountingProductId && mountingQuantity > 0)
      addRequirement(totals, SCOPE_ROLE_MOUNTING_UNIT, mountingProductId, mountingQuantity);
  }
  const requirements = [...totals.values()].map((entry) => ({
    sourceRole: entry.role,
    sourceProductId: entry.productId,
    quantity: entry.quantity,
    unit: "EA",
  }));
  if (!requirements.length)
    return fail("NO_EXPANSION_REQUIRED", "Sizing proves no expansion requirement for the scope.");
  return {
    ok: true,
    snapshot: {
      id: snapshot.id,
      versionNumber: snapshot.version_number,
      fingerprint: snapshot.input_fingerprint,
      calculation,
    },
    system,
    engineeringScopeKind,
    requirements,
  };
};

/**
 * Normalize a SCOPE engineering requirement into the single
 * calculatePricingLine input. Fails closed (throws with a stable code) when
 * the engineering authority is absent, stale, or no longer resolves the
 * requested requirement identity.
 */
// PRODUCTION COMMERCIAL-AUTHORITY BOUNDARY.
//
// Exactly as worker/pricing-runtime.mjs: the caller-supplied
// `allowExpiredOrMissingValidity` option is REMOVED. Temporal relaxation is
// derived ONLY from a current governed commercial_conditions policy scoped to
// the exact applicable price source version. A caller boolean is never
// commercial authority.
export const loadScopePricingInput = async (
  db,
  {
    projectId,
    scenario,
    scopeKey,
    body = {},
  },
) => {
  const kind = scopeKey?.engineeringScopeKind;
  const system = scopeKey?.system;
  const role = scopeKey?.sourceRole;
  const productId = scopeKey?.sourceProductId;
  if (!kind || !system || !role || !productId)
    throw Object.assign(new Error("The engineering scope identity is required."), {
      code: "SCOPE_IDENTITY_REQUIRED",
    });
  const resolved = await resolveScopePricingRequirements(db, {
    projectId,
    system,
    engineeringScopeKind: kind,
  });
  if (!resolved.ok)
    throw Object.assign(new Error(resolved.reason || "Panel-sizing expansion authority is not available."), {
      code: resolved.code,
    });
  const requirement = resolved.requirements.find(
    (entry) => entry.sourceRole === role && entry.sourceProductId === productId,
  );
  if (!requirement) {
    const roleEntry = resolved.requirements.find((entry) => entry.sourceRole === role);
    if (roleEntry)
      throw Object.assign(
        new Error(
          `The expansion product for ${role} changed from ${productId} to ${roleEntry.sourceProductId}. Re-price against the current snapshot.`,
        ),
        { code: "SCOPE_REQUIREMENT_NOT_CURRENT" },
      );
    throw Object.assign(
      new Error("No expansion requirement matches the requested engineering scope identity."),
      { code: "NO_REQUIREMENT_FOUND" },
    );
  }
  const product = await db
    .prepare(
      "SELECT p.requested_product_id product_id, p.part_number, p.lifecycle_status, m.name manufacturer FROM canonical_library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id WHERE p.requested_product_id=?",
    )
    .bind(productId)
    .first();
  if (!product)
    throw Object.assign(new Error("The expansion product is not resolved in the governed product library."), {
      code: "SCOPE_REQUIREMENT_NOT_CURRENT",
    });
  const records = await db
    .prepare("SELECT * FROM price_records WHERE product_id=? ORDER BY reviewed_at DESC, created_at DESC")
    .bind(productId)
    .all();
  const supersededSourceIds = await loadSupersededPriceSourceIds(db);
  const priceSources = (records.results || []).map((record) => ({
    id: record.id,
    productId: record.product_id,
    projectId: record.project_id || null,
    amount: Number(record.amount_minor || 0) / 100,
    currency: record.currency,
    priceType: record.price_type,
    reference: record.id,
    reliability: null,
    minimumQuantity: record.minimum_quantity,
    region: null,
    approvalStatus: record.approval_status,
    downstreamUse: record.downstream_use,
    effectiveFrom: record.effective_from,
    validUntil: record.valid_until,
    status: record.status || record.validity_state,
    supersededAt: record.superseded_at ?? null,
    sourceVersionSuperseded: isSourceVersionSuperseded(record, supersededSourceIds),
    unit: record.unit,
  }));
  const validityPolicy = await resolvePriceValidityPolicy(
    db,
    (records.results || []).map((record) => record.source_id).filter(Boolean),
  );
  return {
    projectId,
    projectCurrency: scenario.project_currency,
    productId,
    partNumber: product.part_number,
    manufacturer: product.manufacturer,
    quantity: requirement.quantity,
    unit: requirement.unit,
    region: undefined,
    calculatedAt: new Date().toISOString(),
    allowExpiredOrMissingValidity: validityPolicy.allows === true,
    validityPolicy,
    priceSources,
    selectedPriceSourceId: body.selectedPriceSourceId ?? null,
    sourcePrecedence: undefined,
    exchangeRate: null,
    discounts: [],
    costComponents: [],
    sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 0 },
    precision: 2,
    technicalAuthority: {
      validated: true,
      scope: kind,
      snapshotId: resolved.snapshot.id,
      snapshotFingerprint: resolved.snapshot.fingerprint,
    },
    source: {
      type: "SCOPE",
      identity: {
        engineeringScopeKind: kind,
        system,
        sourceRole: role,
        sourceProductId: productId,
      },
      provenance: {
        snapshotId: resolved.snapshot.id,
        snapshotVersionNumber: resolved.snapshot.versionNumber,
        snapshotFingerprint: resolved.snapshot.fingerprint,
      },
    },
    versions: {
      scopeSnapshot: resolved.snapshot.id,
      scopeSnapshotVersion: resolved.snapshot.versionNumber,
      scopeFingerprint: resolved.snapshot.fingerprint,
      engineeringScopeKind: kind,
      system,
    },
    safetyDecision: null,
  };
};

/**
 * The SCOPE analog of assertCommercialCostFreshness: prove that a persisted
 * SCOPE pricing run was priced from the still-current sizing snapshot, still
 * resolves the identical requirement identity, still carries the identical
 * requirement quantity, and still rests on governed price evidence.
 */
export const assertScopePricingFreshness = async (db, { projectId, line, lockedCost }) => {
  if (!lockedCost || lockedCost.sourceType !== "SCOPE")
    return fail("STALE_PRICING_COST", "Missing SCOPE authoritative cost lock.");
  if (String(line.source_snapshot_id || "") !== String(lockedCost.snapshotId || ""))
    return fail("STALE_PRICING_COST", "The SCOPE cost lock no longer matches the priced line.");
  const resolved = await resolveScopePricingRequirements(db, {
    projectId,
    system: String(line.system || ""),
    engineeringScopeKind:
      String(line.engineering_scope_kind || "") || SCOPE_KIND_PANEL_SIZING,
  });
  if (!resolved.ok)
    return fail(resolved.code, resolved.reason || "The engineering requirement is no longer authoritatively current.");
  if (
    String(line.source_snapshot_id || "") !== resolved.snapshot.id ||
    String(line.source_fingerprint || "") !== resolved.snapshot.fingerprint
  )
    return fail(
      "SCOPE_SNAPSHOT_NOT_CURRENT",
      "The pricing run was calculated from a superseded panel-sizing snapshot.",
    );
  const requirement = resolved.requirements.find(
    (entry) =>
      entry.sourceRole === String(line.source_role || "") &&
      entry.sourceProductId === String(line.source_product_id || ""),
  );
  if (!requirement)
    return fail(
      "SCOPE_REQUIREMENT_NOT_CURRENT",
      "The priced requirement no longer resolves from the current snapshot.",
    );
  if (Number(requirement.quantity) !== Number(line.quantity))
    return fail(
      "SCOPE_REQUIREMENT_NOT_CURRENT",
      `The requirement quantity changed from ${line.quantity} to ${requirement.quantity}.`,
    );
  if (line.selected_price_record_id) {
    const [record, supersededSourceIds] = await Promise.all([
      db.prepare("SELECT * FROM price_records WHERE id=?").bind(line.selected_price_record_id).first(),
      loadSupersededPriceSourceIds(db),
    ]);
    if (!record || record.approval_status !== "Approved" || record.downstream_use !== "Costing")
      return fail("STALE_PRICING_COST", "The priced cost evidence is no longer governed.");
    const validity = priceValidity(
      {
        status: record.status || record.validity_state,
        supersededAt: record.superseded_at ?? null,
        sourceVersionSuperseded: isSourceVersionSuperseded(record, supersededSourceIds),
        validUntil: record.valid_until,
        effectiveFrom: record.effective_from,
      },
      new Date().toISOString(),
    );
    if (["Rejected", "Future", "Expired", "No Validity Provided"].includes(validity))
      return fail("STALE_PRICING_COST", "The priced cost evidence is no longer current.");
  }
  return { ok: true };
};

/**
 * Build the authoritative-canonical cost lock tagged as a SCOPE lock, mirroring
 * the FULL BOM COST lock the PRODUCT approval path persists into
 * pricing_runs.locked_versions.
 */
export const buildScopeAuthoritativeCost = ({ result, input }) => ({
  sourceType: "SCOPE",
  productId: input.source.identity.sourceProductId,
  quantity: input.quantity,
  unit: input.unit,
  totalCost: result.totalCost,
  netSelling: result.netSelling,
  finalValue: result.finalValue,
  selectedPriceRecordId: result.selectedSource?.id || null,
  snapshotId: input.source.provenance.snapshotId,
  snapshotFingerprint: input.source.provenance.snapshotFingerprint,
  readiness: "SCOPE_COST_READY",
});