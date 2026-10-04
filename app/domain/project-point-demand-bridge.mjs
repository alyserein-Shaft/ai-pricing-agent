// GOVERNED PRELIMINARY POINT-DEMAND BRIDGE (Phase F / H1 / H8).
//
// TWO PRODUCTION DEFECTS THIS CLOSES, both independently reproduced:
//
// H1 -- `aggregatePreliminaryPointDemand` in
//   `app/domain/fire-alarm-preliminary-point-demand.mjs` had ZERO production
//   callers. The engine existed, was fully specified, and was unreachable.
//
// H8 -- `worker/fire-alarm-preliminary-sizing-api.mjs` called
//   `createFireAlarmPreliminarySizingSnapshot({ command })` while the writer's
//   contract is `({ command, dependencies })` where `dependencies.demand` is the
//   governed output of `aggregatePreliminaryPointDemand`. Every POST therefore
//   failed with PRELIMINARY_SIZING_CALCULATION_MALFORMED (422).
//
// So the sizing writer demanded a governed result that nothing produced, from a
// handler that never passed it.
//
// WHAT THIS MODULE DOES. It builds the governed device inventory for a project
// from data the pipeline ALREADY governs -- the current BOQ items, their
// approved understanding, and the SLC resource classification the requirement
// engine already computes and persists on every profile -- then hands it to the
// existing producer. It does NOT re-implement the producer, and it does not
// invent demand.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   * It does not guess point demand. A population with no governed
//     classification lands in `unknown`, exactly as the producer intends.
//   * It does not coerce an unknown quantity to zero.
//   * It does not treat an unresolved SLC role as a resolved addressable
//     point. The producer's own invariant 2 (unresolved consumption lands in
//     unknown, never in known) is preserved untouched.
//   * It does not decide the ecosystem or the protocol. Point demand is an
//     engineering consequence of the approved device population, and a
//     population that has not been classified is honestly unknown.
//
// AGGREGATION AUTHORITY. Quantities come from `currentSelectedQuantity`, the
// same governed quantity authority the rest of the pipeline uses, so a
// demand figure can never disagree with the quantity the rest of the system
// prices.

import {
  aggregatePreliminaryPointDemand,
  buildDeviceInventoryRecord,
  PRELIMINARY_POINT_THRESHOLD,
} from "./fire-alarm-preliminary-point-demand.mjs";
// CURRENT-BOQ-AUTHORITY consolidation: the project population is selected
// through the canonical shared predicates, never a hand-typed join. This is
// the one app->worker import in the domain layer, and the direction is safe:
// worker/current-evidence-scope.mjs depends only on
// app/domain/effective-time-policy.mjs, so no cycle is possible. The
// alternative -- re-typing the currency join here -- is exactly the defect
// this repair closes (the previous query ignored extraction supersession,
// extraction status, the governing document version, deleted/archived scope,
// and admitted every row_type except 'Header').
import {
  currentBoqEvidenceFrom,
  currentBoqItemPredicate,
} from "../../worker/current-evidence-scope.mjs";

const text = (value) => (value === null || value === undefined ? null : String(value).trim() || null);

// A governed quantity is a real number or it is ABSENT.
//
// `Number(null) === 0` and `Number("") === 0` are both finite, so a naive
// numeric check silently converts a missing quantity into a population of ZERO
// -- which is exactly the coercion the producer exists to prevent, and the
// class of defect that must never reappear. Null, undefined, an empty string
// and a blank string are therefore all rejected BEFORE any numeric conversion.
const governedQuantity = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

// The persisted profile column is a JSON STRING, not an object. Reading it
// without parsing yields `profile.boqItem === undefined`, which silently makes
// every population look UNCLASSIFIED. Parse defensively and fail closed.
const readProfilePayload = (row) => {
  if (!row) return null;
  const raw = typeof row === "string" ? safeParse(row) : row.profile ?? null;
  if (raw === null) return null;
  if (typeof raw === "string") return safeParse(raw);
  return typeof raw === "object" ? raw : null;
};

const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    // A malformed profile is ABSENT evidence, never a partially parsed one.
    return null;
  }
};

// Read the SLC resource classification the requirement engine already persists
// on the current profile. This is the pipeline's OWN classification; reusing it
// keeps demand and profile in agreement instead of running a second, possibly
// divergent, classifier here.
const readClassification = (row) => {
  const profile = readProfilePayload(row);
  const classification = profile?.boqItem?.slcResourceClassification;
  if (!classification || typeof classification !== "object") return null;
  return {
    state: text(classification.state),
    family: text(classification.family),
    // `governedQuantity`, not `Number.isFinite(Number(...))`: the latter turns a
    // null `unitsPerDevice` into 0, which would make an unresolved device look
    // like one that consumes no points.
    unitsPerDevice: governedQuantity(classification.unitsPerDevice),
    demandUnits: governedQuantity(classification.demandUnits),
    addressability: text(classification.addressability),
    // The classifier already records the governed quantity decision and its
    // authority. Preferring it keeps demand and the profile in agreement.
    quantity: governedQuantity(classification.quantity?.value),
    quantityAuthority: text(classification.quantity?.source),
    reason: text(classification.reason),
    classifierVersion: text(classification.classifierVersion),
  };
};

// The governed addressability evidence, when it exists. Absent evidence stays
// absent: it is never inferred from the family name or the BOQ description.
const readAddressability = (approvedUnderstanding) => {
  const attributes = approvedUnderstanding?.attributes || {};
  const raw =
    attributes.addressing?.value ??
    attributes.addressability?.value ??
    attributes.addressing ??
    null;
  return text(raw);
};

export const buildProjectPointDemandInventory = async ({ db, projectId, loadCurrentProfile, loadApprovedUnderstanding, currentSelectedQuantity }) => {
  // The population is the canonical current-BOQ-item set intersected with the
  // R4 active-engineering contract. Currency and item-kind come from the shared
  // predicates -- current extraction evidence under the DOC-R3 governing
  // document version, real BOQ item rows only (`row_type IN ('Item','BOQ Item')`,
  // never `<> 'Header'`, which admits sections, subtotals and notes). The
  // `approved_for_downstream = 1` conjunct is the downstream-eligibility axis
  // the bridge's own contract requires (sizing is engineering work: terminal
  // and unapproved rows must not enter demand); it is a consumer-side filter
  // on the canonical population, not a second definition of "current".
  const items = (await db
    .prepare(
      `SELECT b.* FROM ${currentBoqEvidenceFrom("b")}
        WHERE b.project_id = ? AND ${currentBoqItemPredicate("b")} AND b.approved_for_downstream = 1`,
    )
    .bind(projectId)
    .all()).results || [];

  const records = [];
  for (const item of items) {
    const [profile, approved] = await Promise.all([
      loadCurrentProfile(db, item.id),
      loadApprovedUnderstanding(db, projectId, item.id),
    ]);
    const classification = readClassification(profile);
    const selected = await currentSelectedQuantity(db, item);

    // The SLC classifier records the quantity decision it was run against,
    // together with that decision's authority. Prefer the classifier's record so
    // demand can never disagree with the profile that classified it; fall back to
    // the live quantity authority when the classifier carried none.
    const quantityValue = classification?.quantity ?? governedQuantity(selected?.value);
    const quantityAuthority = classification?.quantityAuthority || text(selected?.source) || "BOQ";

    // A population with no governed classification is carried as an inventory
    // record with unknown addressability, so the producer settles it into
    // `unknown` demand rather than the bridge inventing a class.
    const record = buildDeviceInventoryRecord({
      populationId: item.id,
      deviceFamily: classification?.family || text(approved?.productFamily?.value) || null,
      system: text(approved?.system?.value) || text(item.system_value) || "Fire Alarm",
      addressability: classification?.addressability || readAddressability(approved),
      attributes: {},
      governingSource: quantityAuthority,
      confidence: governedQuantity(item.extraction_confidence),
      reviewStatus: text(item.review_status) || "Needs Review",
      // The governed quantity belongs on the SOURCE, not on the record: the
      // producer reconciles population quantity from `sources[].quantity`, and a
      // source with no numeric quantity is treated as absent evidence rather
      // than as a population of zero. A null quantity is therefore passed
      // through as null and settles the population as QUANTITY_UNKNOWN.
      sources: [
        {
          authority: quantityAuthority,
          source: text(item.item_number) || text(item.id),
          scope: "BOQ Item",
          quantity: quantityValue,
        },
        ...(classification?.classifierVersion
          ? [{ authority: classification.classifierVersion, source: classification.reason || "SLC resource classification", scope: "Requirement Profile" }]
          : []),
      ],
    });

    records.push({
      record,
      quantity: quantityValue,
      quantityAuthority,
      itemId: item.id,
      description: text(item.description),
      classification,
    });
  }

  return { items: records, itemCount: items.length };
};

/**
 * Produce the governed point-demand result for a project.
 * Returns the exact shape the sizing writer requires as `dependencies.demand`.
 */
export const produceProjectPreliminaryPointDemand = async ({ db, projectId, loadCurrentProfile, loadApprovedUnderstanding, currentSelectedQuantity, threshold = PRELIMINARY_POINT_THRESHOLD }) => {
  const { items } = await buildProjectPointDemandInventory({
    db,
    projectId,
    loadCurrentProfile,
    loadApprovedUnderstanding,
    currentSelectedQuantity,
  });

  const records = items.map((entry) => entry.record);
  // The governing quantity authority is whatever the pipeline's own quantity
  // decision named, so the producer resolves a population by the same authority
  // the rest of the system uses. It is derived, not assumed to be "BOQ".
  const governingAuthority =
    items.find((entry) => entry.quantityAuthority)?.quantityAuthority || "BOQ";
  const aggregated = aggregatePreliminaryPointDemand(records, { threshold, governingAuthority });

  // Preserve a per-population trace so a sizing snapshot can be audited back to
  // the exact populations and the classification that produced each figure.
  return {
    ...aggregated,
    generatedFrom: {
      projectId,
      populationCount: items.length,
      producer: "aggregatePreliminaryPointDemand",
      bridge: "project-point-demand-bridge",
      populations: items.map((entry) => ({
        populationId: entry.itemId,
        description: entry.description,
        quantity: entry.quantity,
        slcState: entry.classification?.state || "UNCLASSIFIED",
        slcFamily: entry.classification?.family || null,
        unitsPerDevice: entry.classification?.unitsPerDevice ?? null,
        classifierVersion: entry.classification?.classifierVersion || null,
      })),
    },
  };
};
