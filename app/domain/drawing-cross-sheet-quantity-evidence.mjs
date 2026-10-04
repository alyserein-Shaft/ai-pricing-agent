// CROSS-SHEET GOVERNED OCCURRENCE EVIDENCE -> drawing quantity-evidence handoff.
//
// WHY. The quantity-evidence handoff had exactly one input mode: a
// SAME-DOCUMENT symbol-recognition version (definition + recognition +
// occurrences on one sheet). Real project governance frequently does not look
// like that: the legend definition lives on a legend sheet while the physical
// occurrences live on other sheets, bound by a human-governed cross-sheet
// reference. Forcing that project through recognition would mean inventing
// per-sheet legend structure that does not exist -- fabricated evidence.
//
// SO THIS IS A SECOND INPUT MODE, not a second quantity system. The aggregate
// itself is still produced by `computeApprovedQuantityEvidence`, so the
// "occurrence count is not a device quantity" contract is preserved verbatim and
// cannot be weakened from here.
//
// FAIL CLOSED. Every eligibility condition is evaluated explicitly and named.
// If ANY fails, the whole handoff is refused: a partial cross-sheet handoff
// would let a downstream consumer read governed-looking numbers from evidence
// that was never governed. No AI confidence, model score or similarity value
// participates in any gate -- only human-governed rows and exact provenance.

import { computeApprovedQuantityEvidence } from "./drawing-quantity-evidence-engine.mjs";

export const CROSS_SHEET_EVIDENCE_MODE = "CROSS_SHEET_GOVERNED_OCCURRENCE_EVIDENCE";
export const SAME_DOCUMENT_EVIDENCE_MODE = "SAME_DOCUMENT_RECOGNITION";

// Named eligibility conditions. Consumers can assert on them; the handoff
// reports which ones were satisfied and with what evidence.
export const CROSS_SHEET_ELIGIBILITY_CONDITIONS = Object.freeze([
  "LEGEND_DEFINITION_GOVERNED",
  "LEGEND_SOURCE_CURRENT",
  "APPLICABILITY_GOVERNED",
  "TARGETS_CURRENT",
  "TARGET_DRAWING_NUMBERS_GOVERNED",
  "OCCURRENCE_PROVENANCE_COMPLETE",
  "LEGEND_DEFINITION_OCCURRENCES_EXCLUDED",
  "MEASURED_COVERAGE_PRESENT",
  "PROJECT_EVIDENCE_ONLY",
  "AMBIGUITY_REPRESENTED",
]);

const isNonEmpty = (value) => typeof value === "string" && value.trim() !== "";
const hasGeometry = (box) => !!box && Number.isFinite(box.x) && Number.isFinite(box.y)
  && Number.isFinite(box.width) && Number.isFinite(box.height);

const definitionKeyFor = (legendDocumentId, token) => `legendDefinition:${legendDocumentId}:${token}`;

/**
 * Build a governed cross-sheet handoff, or refuse it with the exact conditions
 * that failed. Pure: the caller supplies already-read, project-scoped rows.
 */
export function resolveCrossSheetGovernedQuantityEvidence({
  projectId = null,
  legendSource = {},
  definitions = [],
  applicability = [],
  targets = [],
  occurrences = [],
  coverage = [],
  exclusions = [],
  ambiguity = [],
  foreignEvidencePresent = false,
} = {}) {
  const failed = [];
  const satisfied = {};

  const fail = (condition, detail) => failed.push({ condition, detail });
  const pass = (condition, detail) => { satisfied[condition] = detail ?? true; };

  // 1. A human-governed definition on the requested legend document.
  const governedDefinitions = definitions.filter((definition) => isNonEmpty(definition.token) && isNonEmpty(definition.description));
  if (!governedDefinitions.length) {
    fail("LEGEND_DEFINITION_GOVERNED", "no approved legend definition with a token and description");
  } else {
    pass("LEGEND_DEFINITION_GOVERNED", `${governedDefinitions.length} approved definition(s)`);
  }

  // 2. The legend document/version/intake the definitions belong to is current.
  if (legendSource.currentIntakeCompleted !== true || !isNonEmpty(legendSource.documentVersionId) || !isNonEmpty(legendSource.drawingIntakeVersionId)) {
    fail("LEGEND_SOURCE_CURRENT", "legend source intake is not the current Completed intake, or its version binding is missing");
  } else {
    pass("LEGEND_SOURCE_CURRENT", `${legendSource.documentId} @ ${legendSource.drawingIntakeVersionId}`);
  }

  // 3. Human-governed applicability facts bound to a governed definition.
  const definitionTokens = new Set(governedDefinitions.map((definition) => definition.token));
  const governedApplicability = applicability.filter((fact) => definitionTokens.has(fact.token) && isNonEmpty(fact.object) && isNonEmpty(fact.targetDocumentId));
  if (!governedApplicability.length) {
    fail("APPLICABILITY_GOVERNED", "no approved cross-sheet applicability fact binds a governed definition to a target document");
  } else {
    pass("APPLICABILITY_GOVERNED", `${governedApplicability.length} approved applicability fact(s)`);
  }

  // 4. Every contributing target is current.
  const applicabilityTargets = [...new Set(governedApplicability.map((fact) => fact.targetDocumentId))];
  const targetById = new Map(targets.map((target) => [target.documentId, target]));
  const currentTargets = applicabilityTargets
    .map((documentId) => targetById.get(documentId))
    .filter((target) => target && target.currentIntakeCompleted === true && isNonEmpty(target.documentVersionId) && isNonEmpty(target.drawingIntakeVersionId));
  if (currentTargets.length !== applicabilityTargets.length) {
    fail("TARGETS_CURRENT", `${applicabilityTargets.length - currentTargets.length} target(s) are not on their current Completed intake`);
  } else {
    pass("TARGETS_CURRENT", `${currentTargets.length} target(s) current`);
  }

  // 5. Every contributing target has a GOVERNED drawing number. A blank number
  //    would leave cross-sheet resolution resting on a filename.
  const missingNumbers = currentTargets.filter((target) => !isNonEmpty(target.drawingNumber) || target.drawingNumberGoverned !== true);
  if (missingNumbers.length) {
    fail("TARGET_DRAWING_NUMBERS_GOVERNED", `${missingNumbers.length} target(s) lack a governed drawing number`);
  } else {
    pass("TARGET_DRAWING_NUMBERS_GOVERNED", currentTargets.map((target) => target.drawingNumber).join(", "));
  }

  const eligibleTargets = currentTargets.filter((target) => isNonEmpty(target.drawingNumber) && target.drawingNumberGoverned === true);
  const eligibleTargetIds = new Set(eligibleTargets.map((target) => target.documentId));

  // 6. Every occurrence carries exact source provenance.
  const governedOccurrences = occurrences.filter((occurrence) => eligibleTargetIds.has(occurrence.documentId) && isNonEmpty(occurrence.token));
  const incompleteProvenance = governedOccurrences.filter((occurrence) => !isNonEmpty(occurrence.occurrenceId)
    || !Array.isArray(occurrence.sourceAssetIds) || occurrence.sourceAssetIds.length === 0
    || !Number.isFinite(Number(occurrence.pageNumber))
    || !hasGeometry(occurrence.boundingBox));
  if (incompleteProvenance.length) {
    fail("OCCURRENCE_PROVENANCE_COMPLETE", `${incompleteProvenance.length} occurrence(s) lack asset id, page or bbox provenance`);
  } else {
    pass("OCCURRENCE_PROVENANCE_COMPLETE", `${governedOccurrences.length} occurrence(s) fully provenanced`);
  }

  // 7. A governed legend definition is never a physical field occurrence.
  const definitionSymbolAssetIds = new Set(governedDefinitions.map((definition) => definition.symbolAssetId).filter(Boolean));
  const leakedDefinitionOccurrences = governedOccurrences.filter((occurrence) =>
    (occurrence.sourceAssetIds || []).some((assetId) => definitionSymbolAssetIds.has(assetId)));
  if (leakedDefinitionOccurrences.length) {
    fail("LEGEND_DEFINITION_OCCURRENCES_EXCLUDED", `${leakedDefinitionOccurrences.length} governed definition occurrence(s) leaked into field evidence`);
  } else {
    pass("LEGEND_DEFINITION_OCCURRENCES_EXCLUDED", `${definitionSymbolAssetIds.size} definition symbol(s) excluded`);
  }

  const fieldOccurrences = governedOccurrences.filter((occurrence) => !leakedDefinitionOccurrences.includes(occurrence));

  // 8. Measured coverage exists for every contributing sheet.
  const coverageByDocument = new Map(coverage.map((entry) => [entry.documentId, entry]));
  const missingCoverage = eligibleTargets.filter((target) => !coverageByDocument.get(target.documentId));
  if (missingCoverage.length) {
    fail("MEASURED_COVERAGE_PRESENT", `${missingCoverage.length} contributing sheet(s) have no measured coverage`);
  } else {
    pass("MEASURED_COVERAGE_PRESENT", `${eligibleTargets.length} sheet(s) measured`);
  }

  // 9. No foreign or stale project evidence participates.
  const foreign = occurrences.filter((occurrence) => occurrence.projectId && occurrence.projectId !== projectId);
  if (foreignEvidencePresent === true || foreign.length) {
    fail("PROJECT_EVIDENCE_ONLY", "foreign-project evidence was supplied");
  } else {
    pass("PROJECT_EVIDENCE_ONLY", "all evidence project-scoped and current");
  }

  // 10. Unresolved ambiguity is represented explicitly rather than dropped.
  pass("AMBIGUITY_REPRESENTED", `${ambiguity.length} ambiguity flag(s) carried`);

  if (failed.length) {
    return {
      ok: false,
      evidenceMode: CROSS_SHEET_EVIDENCE_MODE,
      failedConditions: failed,
      satisfiedConditions: satisfied,
    };
  }

  // Aggregate through the EXISTING engine so the device-quantity contract is
  // inherited rather than restated.
  const engineOccurrences = fieldOccurrences.map((occurrence) => ({
    id: occurrence.occurrenceId,
    pageNumber: Number(occurrence.pageNumber),
    boundingBox: occurrence.boundingBox,
    // Governed identity: the definition is human-approved and this occurrence's
    // applicability to its target sheet is human-approved. That is what
    // "Approved" means here -- it is never inferred from a match score.
    matchedDefinitionKey: definitionKeyFor(legendSource.documentId, occurrence.token),
    matchType: "Governed Cross-Sheet Applicability",
    confidence: null,
    reviewStatus: "Approved",
    scoreComponents: null,
    provenance: {
      projectId: occurrence.projectId ?? projectId,
      targetDocumentId: occurrence.documentId,
      targetDocumentVersionId: occurrence.documentVersionId,
      targetIntakeVersionId: occurrence.intakeVersionId,
      sourceAssetIds: occurrence.sourceAssetIds,
      identityAuthority: occurrence.identityAuthority ?? null,
      governedDrawingNumber: targetById.get(occurrence.documentId)?.drawingNumber ?? null,
      applicabilityFactId: governedApplicability.find((fact) => fact.targetDocumentId === occurrence.documentId && fact.token === occurrence.token)?.id ?? null,
      legendDefinitionKey: definitionKeyFor(legendSource.documentId, occurrence.token),
      legendSourceDocumentId: legendSource.documentId,
      legendSourceDocumentVersionId: legendSource.documentVersionId,
      legendSourceIntakeVersionId: legendSource.drawingIntakeVersionId,
      coverageState: coverageByDocument.get(occurrence.documentId)?.state ?? null,
    },
  }));
  const engineDefinitions = governedDefinitions.map((definition) => ({
    definitionKey: definitionKeyFor(legendSource.documentId, definition.token),
    abbreviation: definition.token,
    description: definition.description,
  }));

  const aggregate = computeApprovedQuantityEvidence({
    occurrences: engineOccurrences,
    definitions: engineDefinitions,
    recognitionVersionId: null,
    documentId: legendSource.documentId,
  });

  return {
    ok: true,
    handoff: {
      engineVersion: aggregate.engineVersion,
      evidenceMode: CROSS_SHEET_EVIDENCE_MODE,
      projectId,
      governedSymbolDefinitions: governedDefinitions.map((definition) => ({
        token: definition.token,
        description: definition.description,
        legendDocumentId: legendSource.documentId,
        legendDocumentVersionId: legendSource.documentVersionId,
        legendIntakeVersionId: legendSource.drawingIntakeVersionId,
        definitionKey: definitionKeyFor(legendSource.documentId, definition.token),
        symbolAssetId: definition.symbolAssetId ?? null,
        reviewActorId: definition.reviewActorId ?? null,
      })),
      legendSource: {
        documentId: legendSource.documentId,
        documentVersionId: legendSource.documentVersionId,
        drawingIntakeVersionId: legendSource.drawingIntakeVersionId,
        drawingNumber: legendSource.drawingNumber ?? null,
      },
      governedApplicability: governedApplicability.map((fact) => ({
        id: fact.id,
        token: fact.token,
        object: fact.object,
        targetDocumentId: fact.targetDocumentId,
        targetDocumentVersionId: fact.targetDocumentVersionId,
        targetIntakeVersionId: fact.targetIntakeVersionId,
        approvedArchitectureVersionId: fact.approvedArchitectureVersionId ?? null,
        reviewActorId: fact.reviewActorId ?? null,
      })),
      contributingTargets: eligibleTargets.map((target) => ({
        documentId: target.documentId,
        documentVersionId: target.documentVersionId,
        drawingIntakeVersionId: target.drawingIntakeVersionId,
        governedDrawingNumber: target.drawingNumber,
        occurrenceCount: fieldOccurrences.filter((occurrence) => occurrence.documentId === target.documentId).length,
        coverageState: coverageByDocument.get(target.documentId)?.state ?? null,
      })),
      groups: aggregate.groups,
      totalApprovedOccurrenceCount: aggregate.totalApprovedOccurrenceCount,
      exclusions: exclusions.map((entry) => ({ ...entry })),
      ambiguityFlags: ambiguity.map((entry) => ({ ...entry })),
      coverage: eligibleTargets.map((target) => coverageByDocument.get(target.documentId)),
      quantityAuthority: {
        // Inherited verbatim from the engine: an occurrence count is evidence,
        // never a device quantity, and no consumer may read it as one.
        isEvidence: true,
        isBoqTruth: false,
        isTenderQuantity: false,
        isEngineerApprovedQuantity: false,
        occurrenceCountUnit: "approved_occurrences",
        isDeviceQuantity: false,
        deviceQuantity: null,
        deviceQuantityStatus: "PRINTED_QUANTITY_AUTHORITY_REQUIRED",
        decidedBy: "QUANTITY_REASONING_STAGE_REQUIRED",
      },
      currentness: {
        legendSourceCurrent: true,
        targetsCurrent: true,
        evaluatedFromGovernedRowsOnly: true,
        foreignOrStaleEvidenceUsed: 0,
      },
      // The shared engine projects a FIXED occurrence field set (id, page, box,
      // match type, status), so the chain is published as its own per-occurrence
      // collection keyed by occurrence id rather than being flattened away -- and
      // the engine is left untouched.
      occurrenceProvenance: fieldOccurrences.map((occurrence) => {
        const target = targetById.get(occurrence.documentId);
        const fact = governedApplicability.find((entry) => entry.targetDocumentId === occurrence.documentId && entry.token === occurrence.token);
        return {
          occurrenceId: occurrence.occurrenceId,
          targetDocumentId: occurrence.documentId,
          targetDocumentVersionId: occurrence.documentVersionId,
          targetIntakeVersionId: occurrence.intakeVersionId,
          governedDrawingNumber: target?.drawingNumber ?? null,
          sourceAssetIds: occurrence.sourceAssetIds,
          pageNumber: Number(occurrence.pageNumber),
          boundingBox: occurrence.boundingBox,
          identityAuthority: occurrence.identityAuthority ?? null,
          applicabilityFactId: fact?.id ?? null,
          legendDefinitionKey: definitionKeyFor(legendSource.documentId, occurrence.token),
          legendSourceDocumentId: legendSource.documentId,
          legendSourceDocumentVersionId: legendSource.documentVersionId,
          legendSourceIntakeVersionId: legendSource.drawingIntakeVersionId,
          coverageState: coverageByDocument.get(occurrence.documentId)?.state ?? null,
        };
      }),
      provenanceChain: {
        order: ["fieldOccurrence", "targetDrawingIntake", "governedApplicabilityFact", "governedLegendDefinition", "legendSourceAssets"],
        keyedBy: "occurrenceId",
        note: "occurrenceProvenance[] carries, per occurrence, the target document/version/intake, source asset ids, governed drawing number, applicability fact id and legend definition key. The chain is never flattened into a bare count.",
      },
      eligibility: { conditions: CROSS_SHEET_ELIGIBILITY_CONDITIONS, satisfied },
    },
  };
}
