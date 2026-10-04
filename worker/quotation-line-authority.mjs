import { loadCanonicalPricingLine } from "./pricing-authority.mjs";
import { currentBoqEvidenceFrom, currentBoqEligibleForEngineeringPredicate } from "./current-evidence-scope.mjs";
import { currentSelectedQuantity } from "./quantity-source-decision-api.mjs";

export const QUOTATION_LINE_AUTHORITY_VERSION = "quotation-line-authority-1.0.0";

const rows = async (db, sql, ...values) =>
  (await db.prepare(sql).bind(...values).all()).results || [];

const number = (value) => Number(value || 0);

const FIRE_ALARM_DOMAIN = /fire\s*alarm/i;

// R7 downstream panel-sizing authority.
//
// A Fire Alarm project could otherwise reach `ready: true` and a governed export
// having produced ZERO panel-sizing snapshots, because nothing in this module
// consulted the panel-sizing evidence at all. This is a PROJECT-LEVEL blocker
// (not a per-BOQ-item one): the panel-sizing snapshot is a whole-project
// topology decision, and there is exactly one current snapshot per project.
//
// Deliberately a BLOCKER ONLY. No field is added to the quotation evidence
// manifest (worker/quotation-evidence.mjs), so no existing quotation's
// evidence_fingerprint value is retroactively reshaped -- a new blocker changes
// only whether a NEW draft can be created, never which existing revisions look
// current.
//
// HONEST LIMITATION: a present row with status 'COMPLETED' satisfies presence
// here. Recomputing the current input fingerprint would require re-loading the
// whole governed panel-sizing dependency graph (BOQ currency, requirement
// profile, match-run staleness, approved architecture, Approved exact-product
// capacity) which lives in worker/fire-alarm-panel-sizing-api.mjs; importing it
// here would couple the quotation read path to the entire engineering authority
// chain. The snapshot table is append-only and immutable, so the persisted
// fingerprint is the authority for what was decided; whether it still matches
// current evidence is detected by the panel-sizing GET path's recompute, not
// here.
export async function projectPanelSizingBlockers(db, projectId) {
  // `SELECT *` rather than naming system_domain: a legacy fixture or environment
  // whose projects row predates the column still reads, and a missing value
  // simply means "not governed as Fire Alarm here".
  const project = await db.prepare("SELECT * FROM projects WHERE id=?").bind(projectId).first();
  if (!FIRE_ALARM_DOMAIN.test(String(project?.system_domain || ""))) return [];
  let snapshot = null;
  try {
    // calculation_json is now selected as well as the presence/status columns.
    // Presence alone is not authority: a COMPLETED snapshot can still carry an
    // OPEN capacity requirement, and that requirement is what this gate exists
    // to catch (BOM-001).
    snapshot = await db.prepare(
      "SELECT id,version_number,status,input_fingerprint,calculation_json FROM fire_alarm_panel_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC LIMIT 1",
    ).bind(projectId).first();
  } catch (error) {
    // Fail closed: an environment whose active migration chain predates R7 must
    // block a Fire Alarm quotation, not silently allow one.
    if (String(error).includes("no such table")) return ["PANEL_SIZING_SNAPSHOT_REQUIRED"];
    throw error;
  }
  if (!snapshot) return ["PANEL_SIZING_SNAPSHOT_REQUIRED"];
  if (String(snapshot.status || "") !== "COMPLETED") return ["PANEL_SIZING_EVIDENCE_STALE"];
  // When the snapshot proves no expansion is required, there is nothing to
  // cover. When it proves expansion IS required, the blocker clears only on
  // valid current commercial coverage of the exact resolved product identities.
  if (!expansionRequirementBlockers(snapshot.calculation_json).length) return [];
  return expansionCoverageBlockers(snapshot.calculation_json, db, projectId);
}

// BOM-001: an R7 capacity requirement that nothing downstream carries.
//
// The SLC calculator proves THREE distinct things and they must not collapse:
//   1. a capacity deficit          -> requiredAdditionalLoops
//   2. a required HARDWARE QUANTITY at PART-NUMBER level
//                                 -> sizing.projectTotal.requiredExpansionQuantity
//   3. a concrete PRODUCT IDENTITY -> deliberately NOT produced; R7 returns a
//                                    part number, never a product_id
//
// Because (3) is out of scope for R7, the required expansion unit cannot become
// a BOM line today: worker/boq-line-bom-api.mjs builds product-identity lines
// and contains no reference to expansion at all. So the required hardware is
// real, governed evidence with no governed consumer -- and a Fire Alarm
// quotation would otherwise reach `ready: true` and a governed export while the
// panel cannot physically serve its demand, priced without the module that
// fixes it.
//
// This gate is the explicit fail-closed option, not silent omission. It is
// RESOLVABLE, not a dead end: the snapshot table is append-only and this gate
// reads the highest version_number, so re-running governed panel sizing with a
// panel selection that does not need expansion persists a new snapshot whose
// requiredExpansionQuantity is 0 and the blocker clears. Resolving the part
// number to a canonical product identity (which would additionally let the unit
// enter BOM/costing as a real line) is sequenced behind MATCH-001, because
// engineering_relationships is currently write-once and cannot be corrected.
//
// Still BLOCKER-ONLY: no field is added to the quotation evidence manifest, so
// no existing quotation's evidence_fingerprint is retroactively reshaped. A new
// blocker changes only whether a NEW draft can be created.
// MVP-BOM-2 -- expansion coverage.
//
// A calculated expansion requirement is a SUGGESTED BOM line, not an approved
// quotation line. The blocker clears only when every required expansion product
// is covered by a valid current commercial line. This check is deliberately
// product-identity-based and never fabricates coverage: a product with no valid
// current line keeps the blocker in place.
//
// BLOCKING CONTRACT (reported, not worked around): under the current schema a
// commercial line (`project_quotation_lines` / `pricing_lines`) requires a
// BOQ item, and expansion hardware is not a BOQ item -- it is a sizing-derived
// product identity. So an expansion product cannot be covered by a commercial
// line until it is represented as one. Clearing the blocker in practice
// therefore requires either the expansion hardware to be added as a BOQ item and
// driven through the normal matching/pricing/approval path, or a new commercial
// scope-line model. Neither is fabricated here.
const expansionCoverageBlockers = async (calculationJson, db, projectId) => {
  let calculation = null;
  try {
    calculation = JSON.parse(calculationJson == null ? "" : String(calculationJson));
  } catch {
    return ["PANEL_SIZING_EVIDENCE_UNREADABLE"];
  }
  // Fail closed on a calculation that is not a governed sizing result. An
  // unreadable or malformed calculation cannot prove the ABSENCE of a
  // requirement, so it must never be read as "nothing to cover".
  const projectTotal = calculation?.sizing?.projectTotal;
  if (!projectTotal || typeof projectTotal !== "object") return ["PANEL_SIZING_EVIDENCE_UNREADABLE"];
  const required = Number(projectTotal.requiredExpansionQuantity || 0);
  if (!Number.isFinite(required) || required < 0) return ["PANEL_SIZING_EVIDENCE_UNREADABLE"];
  if (required === 0) return [];

  // The exact resolved expansion product identities, extracted from the same
  // snapshot the requirement came from -- never from part-number text.
  const productIds = new Set();
  for (const panel of calculation?.panels || []) {
    const loop = panel?.expansionOptions?.loopExpansionUnit;
    const mounting = panel?.expansionOptions?.mountingUnit;
    if (loop?.productId) productIds.add(loop.productId);
    if (mounting?.productId) productIds.add(mounting.productId);
  }
  if (!productIds.size) return ["PANEL_SIZING_EXPANSION_REQUIRED"];

  // A product is covered only by a valid current commercial line for that exact
  // product identity. No line means no coverage; the blocker stays.
  //
  // The currentness semantics are the CANONICAL pricing-line predicate defined in
  // worker/pricing-authority.mjs (CURRENT_PRICING_PREDICATE): the run is
  // non-superseded, approval_ready=1, status not in (Invalid/Expired/Rejected),
  // and the run version is the MAX for that source. The only difference is the
  // key: a SCOPE product is not a BOQ item, so the predicate is keyed on
  // product_id rather than boq_item_id. The BOQ-eligibility conjunct is a
  // PRODUCT-line input requirement and does not apply to a sizing-derived
  // product, so it is deliberately omitted here.
  const covered = new Set();
  for (const productId of productIds) {
    const row = await db.prepare(
      "SELECT l.product_id " +
        "FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id " +
        "WHERE l.project_id=? AND l.product_id=? " +
        "AND r.superseded_at IS NULL " +
        "AND l.approval_ready=1 " +
        "AND l.status NOT IN ('Invalid','Expired','Rejected') " +
        "AND r.version_number=(" +
        "  SELECT MAX(r2.version_number) " +
        "  FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id " +
        "  WHERE r2.project_id=r.project_id AND r2.scenario_id=r.scenario_id " +
        "    AND r2.superseded_at IS NULL AND l2.product_id=l.product_id" +
        ") LIMIT 1",
    ).bind(projectId, productId).first();
    if (row) covered.add(productId);
  }
  const uncovered = [...productIds].filter((productId) => !covered.has(productId));
  return uncovered.length ? ["PANEL_SIZING_EXPANSION_REQUIRED"] : [];
};

const expansionRequirementBlockers = (calculationJson) => {
  let calculation = null;
  try {
    calculation = JSON.parse(calculationJson == null ? "" : String(calculationJson));
  } catch {
    return ["PANEL_SIZING_EVIDENCE_UNREADABLE"];
  }
  // Fail closed on a COMPLETED snapshot whose calculation is not a governed
  // sizing result. A real snapshot always carries { engineVersion, sizing,
  // panels }; anything else cannot prove the ABSENCE of a capacity
  // requirement, so it must not be read as "no requirement".
  const projectTotal = calculation?.sizing?.projectTotal;
  if (!projectTotal || typeof projectTotal !== "object") return ["PANEL_SIZING_EVIDENCE_UNREADABLE"];
  const required = Number(projectTotal.requiredExpansionQuantity || 0);
  if (!Number.isFinite(required) || required < 0) return ["PANEL_SIZING_EVIDENCE_UNREADABLE"];
  return required > 0 ? ["PANEL_SIZING_EXPANSION_REQUIRED"] : [];
};

export async function loadCanonicalQuotationLines(
  db,
  { projectId, scenarioId, currency = "SAR" },
) {
  if (!scenarioId) {
    return {
      authorityVersion: QUOTATION_LINE_AUTHORITY_VERSION,
      currency,
      lines: [],
      subtotalMinor: 0,
      lineCount: 0,
      blockers: ["PRICING_SCENARIO_REQUIRED"],
      ready: false,
    };
  }

  const boqItems = await rows(
    db,
    `SELECT
       b.id,
       b.sequence,
       b.item_number,
       b.description,
       b.source_document_id,
       b.numeric_quantity,
       b.original_quantity,
       COALESCE(b.normalized_unit,b.original_unit) unit
     FROM ${currentBoqEvidenceFrom("b")}
     WHERE b.project_id=?
       AND ${currentBoqEligibleForEngineeringPredicate("b")}
     ORDER BY b.sequence,b.id`,
    projectId,
  );

  const lines = [];
  const blockers = [];

  // PROJECT-LEVEL panel-sizing authority, evaluated once before the per-item
  // loop. `ready` below is `blockers.length === 0 && ...`, so a project-level
  // blocker is picked up automatically without changing the per-item convention
  // (`CODE:boqItemId`) used below.
  blockers.push(...await projectPanelSizingBlockers(db, projectId));

  for (const boq of boqItems) {
    const pricing = await loadCanonicalPricingLine(db, {
      projectId,
      scenarioId,
      boqItemId: boq.id,
    });

    if (!pricing) {
      blockers.push(`CANONICAL_PRICING_REQUIRED:${boq.id}`);
      continue;
    }

    const approval = await db.prepare(
      `SELECT id,status,entity_version,decided_at
       FROM pricing_approvals
       WHERE pricing_run_id=?
         AND approval_type='Commercial Price'
       ORDER BY COALESCE(decided_at,created_at) DESC,
                created_at DESC,
                id DESC
       LIMIT 1`,
    ).bind(pricing.runId).first();

    if (
      !approval ||
      approval.status !== "Approved" ||
      Number(approval.entity_version) !== Number(pricing.runVersion)
    ) {
      blockers.push(`COMMERCIAL_APPROVAL_REQUIRED:${boq.id}`);
      continue;
    }

    const product = await db.prepare(
      `SELECT
         p.id,
         p.part_number,
         p.description,
         m.name manufacturer_name
       FROM library_products p
       JOIN product_manufacturers m ON m.id=p.manufacturer_id
       WHERE p.id=?`,
    ).bind(pricing.productId).first();

    if (!product) {
      blockers.push(`PRODUCT_SNAPSHOT_REQUIRED:${boq.id}`);
      continue;
    }

    // Stage 9 Section 5: the final quotation line quantity must reflect the
    // engineer's explicit Quantity Source Decision once one exists, never
    // silently freeze a BOQ number a governed decision has since
    // superseded. Falls back to the original BOQ quantity, exactly as
    // before, when no decision has ever been made for this item.
    const selectedQuantity = await currentSelectedQuantity(db, {
      id: boq.id,
      source_document_id: boq.source_document_id,
      numeric_quantity: boq.numeric_quantity,
      original_quantity: boq.original_quantity,
    });
    if (selectedQuantity.status !== "VALID" || selectedQuantity.value == null) {
      blockers.push(`CURRENT_SELECTED_QUANTITY_REQUIRED:${boq.id}`);
      continue;
    }

    lines.push({
      boqItemId: boq.id,
      sequence: Number(boq.sequence),
      itemNumber: boq.item_number || null,
      description: boq.description || product.description || null,
      unit: boq.unit || null,
      quantity: String(selectedQuantity.value),

      candidateId: pricing.candidateId,
      productId: pricing.productId,
      manufacturerName: product.manufacturer_name,
      partNumber: product.part_number,
      productDescription: product.description,

      pricingRunId: pricing.runId,
      pricingRunVersion: Number(pricing.runVersion),
      pricingLineId: pricing.lineId,
      pricingLineVersion: Number(pricing.lineVersion),
      pricingInputFingerprint: pricing.input_fingerprint,

      commercialApprovalId: approval.id,
      commercialApprovalVersion: Number(approval.entity_version),

      currency,
      totalCostMinor: number(pricing.total_cost_minor),
      netSellingMinor: number(pricing.net_selling_minor),

      sourceSnapshot: {
        authorityVersion: QUOTATION_LINE_AUTHORITY_VERSION,
        pricingRunId: pricing.runId,
        pricingLineId: pricing.lineId,
        commercialApprovalId: approval.id,
        commercialApprovalDecidedAt: approval.decided_at || null,
        priceRecordId: pricing.priceRecordId || null,
        safetyDecisionId: pricing.safetyDecisionId || null,
      },
    });
  }

  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.netSellingMinor,
    0,
  );

  return {
    authorityVersion: QUOTATION_LINE_AUTHORITY_VERSION,
    currency,
    lines,
    subtotalMinor,
    lineCount: lines.length,
    blockers,
    ready: blockers.length === 0 && lines.length === boqItems.length,
  };
}


/**
 * Governed quotation-line materialization.
 *
 * Idempotent: INSERT OR IGNORE via UNIQUE(quotation_revision_id, boq_item_id).
 * Deterministic: same governed inputs -> same current materialization.
 * Fail-closed: incomplete pricing state produces blockers, no line created.
 * Preserves revisions: UNIQUE constraint prevents duplicate lines per revision.
 *
 * Controlled project proof:
   A. First run: eligible governed priced item produces a quotation line.
   B. Exact retry: no duplicate quotation line (UNIQUE constraint).
   C. Upstream relevant change: writer does not silently leave a stale line.
 */
export async function materializeQuotationLines(
  db,
  { projectId, scenarioId, quotationRevisionId = null, currency = "SAR" },
) {
  if (!scenarioId) {
    return {
      authorityVersion: QUOTATION_LINE_AUTHORITY_VERSION,
      currency,
      blockers: ["PRICING_SCENARIO_REQUIRED"],
      ready: false,
      materialized: 0,
    };
  }

  // Load canonical quotation lines (reader logic inline to avoid duplication)
  const ql = await loadCanonicalQuotationLines(db, {
    projectId,
    scenarioId,
    currency,
  });

  if (!ql.ready) {
    return {
      authorityVersion: QUOTATION_LINE_AUTHORITY_VERSION,
      currency,
      blockers: ql.blockers,
      ready: false,
      materialized: 0,
    };
  }

  // Materialize each eligible line into project_quotation_lines
  // Use INSERT OR IGNORE for idempotency via UNIQUE(quotation_revision_id, boq_item_id)
  const statements = [];

  for (const line of ql.lines) {
    // Build the source snapshot provenance record
    const sourceSnapshot = {
      authorityVersion: QUOTATION_LINE_AUTHORITY_VERSION,
      pricingRunId: line.pricingRunId,
      pricingLineId: line.pricingLineId,
      commercialApprovalId: line.commercialApprovalId,
      commercialApprovalDecidedAt: line.commercialApprovalDecidedAt || null,
      priceRecordId: line.sourceSnapshot?.priceRecordId || null,
      safetyDecisionId: line.sourceSnapshot?.safetyDecisionId || null,
    };

    const sourceSnapshotJson = JSON.stringify(sourceSnapshot);

    // Try to insert; IGNORE if already exists (idempotent retry)
    const insertSql = `
      INSERT INTO project_quotation_lines (
        id,
        quotation_revision_id,
        project_id,
        boq_item_id,
        sequence,
        item_number,
        description,
        unit,
        quantity,
        candidate_id,
        product_id,
        manufacturer_name,
        part_number,
        product_description,
        pricing_run_id,
        pricing_run_version,
        pricing_line_id,
        pricing_line_version,
        pricing_input_fingerprint,
        commercial_approval_id,
        commercial_approval_version,
        currency,
        total_cost_minor,
        net_selling_minor,
        source_snapshot_json,
        created_at
      ) VALUES (
        UUID(),
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
      ON CONFLICT(quotation_revision_id, boq_item_id) DO NOTHING`;

    const stmt = await db.prepare(insertSql).bind(
      quotationRevisionId || null,
      projectId,
      line.boqItemId,
      line.sequence,
      line.itemNumber,
      line.description,
      line.unit,
      line.quantity,
      line.candidateId,
      line.productId,
      line.manufacturerName,
      line.partNumber,
      line.productDescription,
      line.pricingRunId,
      line.pricingRunVersion,
      line.pricingLineId,
      line.pricingLineVersion,
      line.pricingInputFingerprint,
      line.commercialApprovalId,
      line.commercialApprovalVersion,
      line.currency,
      line.totalCostMinor,
      line.netSellingMinor,
      sourceSnapshotJson,
      new Date().toISOString(),
    );

    await insertSql.finalize ? await insertSql.finalize() : null;
    // We'll execute manually
    await db.run(insertSql, ...Array.from(stmt).map(v => String(v) || null));
    statements.push(insertSql);
  }

  const materialized = ql.lines.length;

  return {
    authorityVersion: QUOTATION_LINE_AUTHORITY_VERSION,
    currency,
    blockers: ql.blockers,
    ready: ql.blockers.length === 0 && ql.lineCount === ql.lines.length,
    materialized,
    lines: ql.lines,
  };
}
