// QUANTITY REASONING
// Composes governed occurrence evidence, the drawing quantity semantics layer,
// a governed BOQ comparison, and a bounded referent assessment into one
// deterministic cross-document adjudication artifact.
//
// It never invents a number to reconcile documents, never lets a BOQ quantity
// force a deviceCount, never lets a drawing count overwrite a BOQ, never
// derives a device/zone/module count from manufacturer topology, and never
// uses AI confidence or proximity as authority.

import { resolveDrawingQuantitySemantics } from "./drawing-quantity-semantics.mjs";
import { compareDrawingEvidenceToBoq } from "./drawing-quantity-evidence-engine.mjs";

export const QUANTITY_REASONING_VERSION = "quantity-reasoning-1.0.0";

function fingerprint({ projectId, drawing, boqItem, specFacts, topology }) {
  const parts = [
    projectId,
    drawing?.fingerprint ?? "",
    boqItem?.id ?? "",
    boqItem?.numeric_quantity ?? boqItem?.quantity ?? "",
    specFacts?.fingerprint ?? "",
    topology?.fingerprint ?? "",
  ];
  // Deterministic, stable, not cryptographic.
  let h = 2166136261;
  for (const p of parts) for (let i = 0; i < String(p).length; i++) { h ^= String(p).charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export function adjudicateQuantity({
  projectId,
  drawing,          // { occurrenceCount, perSheet, coverageState, fingerprint, applicability, legend, multiplierEvidence }
  boqItem,          // governed normalized BOQ subject line (or null)
  boqRawRows,       // raw rows kept as evidence only
  specFacts,        // { fingerprint, relevantClauses }
  topology,         // { sourceClasses, fingerprint, relations }
  canonicalInterpretation, // approved drawing/device identity for the link, if any
  currentDocumentVersions = {},
}) {
  const occurrences = drawing?.occurrences ?? [];
  const multipliers = drawing?.multiplierEvidence ?? [];

  // 1) Semantic axes via the governed semantics layer.
  const semantics = resolveDrawingQuantitySemantics({
    occurrences,
    multipliers,
    manufacturerTopologies: topology?.relations ?? [],
    boqItems: boqItem ? [boqItem] : [],
    specifications: specFacts?.relevantClauses ?? [],
    projectId,
    currentDocumentVersions,
  });

  const axes = {};
  for (const axisName of ["occurrenceCount", "deviceCount", "zoneCount", "moduleCount"]) {
    const a = semantics[axisName];
    axes[axisName] = {
      value: a.value,
      authorityStatus: a.authorityStatus,
      evidenceIds: [...(a.evidenceIds ?? [])],
      derivation: a.derivation,
      ambiguityState: a.ambiguityState,
    };
  }

  const referentStates = semantics.multiplierRelations.map((m) => ({
    evidenceId: m.evidenceId ?? null,
    sheet: m.sheet ?? null,
    referent: m.referent,
    association: m.association,
    governedBinding: m.governedBinding,
  }));

  // 2) BOQ comparison using the canonical evidence-engine comparator. A
  // normalized (APPLIED) BOQ quantity is governed even when technical
  // Interpretation/Understanding approval is still pending -- they are
  // separate axes. Only the raw (un-normalized) item is treated as not yet
  // governed.
  const evidenceGroup = drawing?.evidenceGroup ?? null;
  const isAppliedNormalizedBoq = Boolean(boqItem && boqItem.normalizationStatus === "APPLIED");
  let boqComparison;
  if (!boqItem) {
    boqComparison = { status: "BOQ_NOT_GOVERNED_FOR_THIS_SUBJECT", comparable: false, conclusive: false };
  } else if (isAppliedNormalizedBoq) {
    // Present the governed normalized quantity without forcing a match with the
    // drawing occurrence count; reconcile as comparable-or-not.
    const drawingQuantity = drawing?.occurrences?.length ?? null;
    const boqQuantity = Number(boqItem.normalized_quantity ?? boqItem.numeric_quantity ?? boqItem.quantity);
    let status;
    if (drawingQuantity == null || boqQuantity == null) status = "NOT_COMPARABLE";
    else if (drawingQuantity === boqQuantity) status = "MATCH";
    else status = "DIFFERS_FROM_BOQ";
    boqComparison = {
      status,
      comparable: drawingQuantity != null && boqQuantity != null,
      conclusive: false,
      quantityBasis: "GOVERNED_NORMALIZED_QUANTITY",
      deviceQuantityAvailable: false,
      boqQuantity,
      drawingOccurrenceCount: drawingQuantity,
      note: "BOQ quantity is governed normalized scope; BOQ Understanding remains PENDING and this is never a device quantity.",
    };
  } else if (!boqItem.approved_for_downstream && !canonicalInterpretation) {
    boqComparison = { status: "BOQ_NOT_YET_GOVERNED", comparable: false, conclusive: false };
  } else {
    boqComparison = compareDrawingEvidenceToBoq({
      evidenceGroup,
      boqItem,
      canonicalInterpretation,
      reviewStatus: boqItem.review_status,
      coverageState: drawing?.coverageState,
    });
  }

  // 3) Per-relation outcomes (never collapsed into one quantity).
  const outcomeFor = (axisName) => {
    if (axisName === "occurrenceCount") return semantics.occurrenceCount.value != null ? "PROVEN" : "NOT_ESTABLISHED";
    const a = semantics[axisName];
    if (a.value != null && a.authorityStatus === "EVIDENCED") return "PROVEN";
    if (a.value != null) return "SUPPORTED_NOT_AUTHORITATIVE";
    return a.ambiguityState ? "AMBIGUOUS" : "NOT_ESTABLISHED";
  };

  const relation = (from, to, axesDesc) => {
    const a = semantics[to];
    const result = a.value != null && a.authorityStatus === "EVIDENCED" ? "PROVEN" : (a.ambiguityState ? "AMBIGUOUS" : "NOT_ESTABLISHED");
    return { from, to, result, axesDesc };
  };

  const adjudication = {
    version: QUANTITY_REASONING_VERSION,
    projectId,
    fingerprint: fingerprint({ projectId, drawing, boqItem, specFacts, topology }),
    inputs: {
      drawingEvidenceFingerprint: drawing?.fingerprint ?? null,
      boqSubject: boqItem ? { id: boqItem.id, quantity: boqItem.numeric_quantity ?? boqItem.quantity, unit: boqItem.normalized_unit ?? boqItem.unit } : null,
      boqRawRowCount: boqRawRows?.length ?? 0,
      specRelevantClauseCount: specFacts?.relevantClauses?.length ?? 0,
      manufacturerStrategy: topology?.strategy ?? null,
    },
    occurrenceCount: axes.occurrenceCount,
    deviceCount: axes.deviceCount,
    zoneCount: axes.zoneCount,
    moduleCount: axes.moduleCount,
    axisOutcomes: {
      occurrenceCount: outcomeFor("occurrenceCount"),
      deviceCount: outcomeFor("deviceCount"),
      zoneCount: outcomeFor("zoneCount"),
      moduleCount: outcomeFor("moduleCount"),
    },
    relations: {
      occurrenceCountToDeviceCount: relation("occurrenceCount", "deviceCount"),
      deviceCountToZoneCount: relation("deviceCount", "zoneCount"),
      zoneCountToModuleCount: relation("zoneCount", "moduleCount"),
    },
    multiplierReferentStates: referentStates,
    boqComparison,
    authority: {
      deviceQuantityAvailable: axes.deviceCount.value != null,
      quantityClaimsCreateAllowed: false,
      reason: "No declared derivation has governed provenance; no physical quantity is claimed.",
    },
  };

  return adjudication;
}
