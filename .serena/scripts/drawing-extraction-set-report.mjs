#!/usr/bin/env node
// DRAWING INTELLIGENCE -- WORKSTREAM 11: full drawing-set report.
//
// Runs the full, drawing-type-aware intelligence pipeline across every
// Drawing document in a project and produces a machine-readable (.json)
// and human-readable (.md) report. Each sheet's TYPE determines which
// extractor(s) actually run on it (Workstream 1's classifyDrawingType
// dispatches to the matching Workstream 2-6 module) -- a Riser sheet is
// judged by riser/schematic intelligence, a Legend sheet by legend/notes
// intelligence, and so on. A sheet legitimately producing 0 results from
// an extractor that does not apply to its type is not a failure.
//
// Usage: node scripts/drawing-extraction-set-report.mjs [--project <id>] [--db <path>]
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildGeneralDrawingExtractionProposals } from "../app/domain/drawing-general-extraction-engine.mjs";
import { classifyDrawingType } from "../app/domain/drawing-type-classifier.mjs";
import { buildLegendNotesIntelligence } from "../app/domain/drawing-legend-notes-intelligence.mjs";
import { buildRiserSchematicIntelligence } from "../app/domain/drawing-riser-schematic-intelligence.mjs";
import { buildLayoutIntelligence } from "../app/domain/drawing-layout-intelligence.mjs";
import { buildCauseEffectIntelligence } from "../app/domain/drawing-cause-effect-intelligence.mjs";
import { buildDetailIntelligence } from "../app/domain/drawing-detail-intelligence.mjs";
import { detectCrossSheetReferences, resolveCrossSheetReferenceTargets } from "../app/domain/drawing-cross-sheet-references.mjs";

const DEFAULT_DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const DEFAULT_PROJECT = "project_c0123d91-c30b-4956-87cb-e473ef53f89d"; // Al Mousa School

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const dbPath = flag("--db", DEFAULT_DB);
const projectId = flag("--project", DEFAULT_PROJECT);
if (!existsSync(dbPath)) {
  console.error(`Local D1 sqlite file not found at ${dbPath}`);
  process.exit(1);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const parse = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const documents = db
  .prepare("SELECT id,logical_name,document_type FROM documents WHERE project_id=? AND deleted_at IS NULL ORDER BY logical_name")
  .all(projectId);

// Every Drawing document's registered drawing_number, for WORKSTREAM 7's
// exact (never fuzzy) cross-sheet target resolution.
const documentRegistry = documents
  .map((document) => {
    const intakeVersion = db
      .prepare("SELECT id FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1")
      .get(document.id);
    if (!intakeVersion) return null;
    const metadata = db.prepare("SELECT drawing_number FROM drawing_metadata WHERE intake_version_id=?").get(intakeVersion.id);
    return metadata?.drawing_number ? { id: document.id, drawingNumber: metadata.drawing_number } : null;
  })
  .filter(Boolean);

const statusCounts = (statuses) => ({
  verified: statuses.filter((s) => s === "Verified").length,
  verifiedWithAssumption: statuses.filter((s) => s === "Verified with Assumption").length,
  needsReview: statuses.filter((s) => s === "Needs Review").length,
  conflict: statuses.filter((s) => s === "Conflict").length,
  notFound: statuses.filter((s) => s === "Not Found").length,
});

const report = {
  generatedAt: new Date().toISOString(),
  projectId,
  engineVersion: "drawing-general-extraction-engine-1.1.0 + drawing-type-intelligence-1.0.0",
  documents: [],
  totals: null,
};

for (const document of documents) {
  const entry = { documentId: document.id, name: document.logical_name, documentType: document.document_type };
  if (document.document_type !== "Drawing") {
    entry.status = "Not a Drawing document (Drawing Intake does not apply)";
    report.documents.push(entry);
    continue;
  }

  const intakeVersion = db
    .prepare("SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1")
    .get(document.id);
  if (!intakeVersion) {
    entry.status = "Drawing Intake not yet run";
    report.documents.push(entry);
    continue;
  }
  entry.intakeVersionId = intakeVersion.id;

  const classifications = db
    .prepare("SELECT classification_type,confidence FROM drawing_document_classifications WHERE intake_version_id=?")
    .all(intakeVersion.id)
    .map((row) => ({ type: row.classification_type, confidence: row.confidence }));

  const metadata = db.prepare("SELECT * FROM drawing_metadata WHERE intake_version_id=?").get(intakeVersion.id);
  const sourceDocument = { id: document.id, drawingNumber: metadata?.drawing_number ?? null, sheetName: metadata?.sheet_name ?? null };
  entry.drawingNumber = metadata?.drawing_number ?? "Not Found";
  entry.revision = metadata?.revision ?? "Not Found";
  entry.sheetName = metadata?.sheet_name ?? "Not Found";

  const typeResult = classifyDrawingType({ classifications, sheetName: metadata?.sheet_name });
  entry.drawingType = typeResult.drawingType;
  entry.drawingTypeConfidence = typeResult.confidence;
  entry.drawingTypeEvidence = typeResult.evidence;

  const pages = db.prepare("SELECT * FROM drawing_pages WHERE intake_version_id=? ORDER BY page_number").all(intakeVersion.id);
  const assets = db
    .prepare("SELECT * FROM drawing_assets WHERE intake_version_id=? ORDER BY page_id,asset_type")
    .all(intakeVersion.id)
    .map((row) => ({ ...row, bounding_box: parse(row.bounding_box) }));

  // General Drawing Extraction v0 (numbered-schedule + callout pattern)
  // runs on every sheet regardless of type -- it is generic pattern
  // detection, not a type-gated extractor.
  const general = buildGeneralDrawingExtractionProposals({ pages, assets });

  // Type-specific extractor dispatch (WORKSTREAM 1's whole point): only
  // the extractor matching this sheet's OWN classified type runs.
  let typeSpecific = { proposalCounts: {}, primaryIntelligenceTypes: [] };
  const pageNumber = pages[0]?.page_number ?? null;
  if (entry.drawingType === "Legend / Notes") {
    const legendVersion = db.prepare("SELECT id,confidence FROM drawing_legends WHERE intake_version_id=?").get(intakeVersion.id);
    const legendEntries = legendVersion
      ? db.prepare("SELECT * FROM drawing_legend_entries WHERE legend_id=?").all(legendVersion.id)
      : [];
    const result = buildLegendNotesIntelligence({ sourceDocument, pageNumber, assets, legendEntries, legendConfidence: legendVersion?.confidence ?? null });
    typeSpecific.proposalCounts = { legendDefinitions: result.legendDefinitions.length, generalNotes: result.generalNotes.length };
    typeSpecific.primaryIntelligenceTypes = ["LegendDefinition", "GeneralNote"];
    typeSpecific.statuses = [...result.legendDefinitions, ...result.generalNotes].map((p) => p.governedStatus);
  } else if (entry.drawingType === "Riser Diagram" || entry.drawingType === "Schematic / Single-Line") {
    const result = buildRiserSchematicIntelligence({ sourceDocument, pageNumber, drawingType: entry.drawingType, assets });
    typeSpecific.proposalCounts = {
      loops: result.loops.length,
      cableSpecs: result.cableSpecs.length,
      systemInterfaces: result.systemInterfaces.length,
      connectionCandidates: result.connectionCandidates.length,
      deviceCodes: result.deviceCodes.length,
    };
    typeSpecific.primaryIntelligenceTypes = ["LoopCandidate", "CableSpecCandidate", "SystemInterfaceCandidate", "ConnectionCandidate"];
    typeSpecific.statuses = [...result.loops, ...result.cableSpecs, ...result.systemInterfaces, ...result.connectionCandidates, ...result.deviceCodes].map((p) => p.governedStatus);
  } else if (entry.drawingType === "Layout") {
    const result = buildLayoutIntelligence({ sourceDocument, pageNumber, drawingType: entry.drawingType, assets });
    typeSpecific.proposalCounts = { devicePlacements: result.devicePlacements.length, detailReferences: result.detailReferences.length };
    typeSpecific.primaryIntelligenceTypes = ["DevicePlacementCandidate"];
    typeSpecific.statuses = [...result.devicePlacements, ...result.detailReferences].map((p) => p.governedStatus);
  } else if (entry.drawingType === "Cause & Effect") {
    const result = buildCauseEffectIntelligence({ sourceDocument, pageNumber, drawingType: entry.drawingType, assets });
    typeSpecific.proposalCounts = { headers: result.headers.length, relationships: result.relationships.length };
    typeSpecific.primaryIntelligenceTypes = ["MatrixRelationshipCandidate"];
    typeSpecific.statuses = [...result.headers, ...result.relationships].map((p) => p.governedStatus);
  } else if (entry.drawingType === "Detail / Enlarged Detail") {
    const result = buildDetailIntelligence({ sourceDocument, pageNumber, drawingType: entry.drawingType, assets });
    typeSpecific.proposalCounts = { installationRequirements: result.installationRequirements.length, detailNumbers: result.detailNumbers.length };
    typeSpecific.primaryIntelligenceTypes = ["InstallationRequirementCandidate", "DetailNumberCandidate"];
    typeSpecific.statuses = [...result.installationRequirements, ...result.detailNumbers].map((p) => p.governedStatus);
  } else {
    typeSpecific.statuses = [];
  }
  entry.typeSpecificProposals = typeSpecific.proposalCounts;
  entry.primaryIntelligenceTypesExpected = typeSpecific.primaryIntelligenceTypes;

  entry.equipmentSchedulesDetected = general.scheduleItems.length;
  entry.equipmentProposals = general.scheduleItems.length + general.equipmentCandidates.length;
  entry.callouts = general.callouts.length;
  entry.excludedCallouts = general.excludedCallouts.length;
  entry.panelCandidates = general.equipmentCandidates.filter((c) => c.proposalType === "PanelCandidate").length;
  entry.unresolvedAmbiguous = general.unresolved.length;

  const structureVersion = db.prepare("SELECT * FROM drawing_structure_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").get(document.id);
  entry.structuralRegions = structureVersion
    ? db.prepare("SELECT COUNT(*) count FROM drawing_structure_regions WHERE structure_version_id=?").get(structureVersion.id).count
    : "Not Found (structural parsing not yet run)";

  const generalStatuses = [...general.scheduleItems, ...general.callouts, ...general.equipmentCandidates, ...general.regionCandidates].map((p) => p.governedStatus);
  const allStatuses = [...generalStatuses, ...typeSpecific.statuses];
  entry.governedStatusCounts = statusCounts(allStatuses);
  entry.proposalsExtracted = allStatuses.length;

  const textAssets = assets.filter((asset) => asset.asset_type === "Text" || asset.asset_type === "Legend");
  const rawReferences = [];
  for (const asset of textAssets) {
    rawReferences.push(...detectCrossSheetReferences({ sourceDocument, pageNumber: pages.find((page) => page.id === asset.page_id)?.page_number ?? null, assets: [asset] }));
  }
  const resolvedReferences = resolveCrossSheetReferenceTargets(rawReferences, documentRegistry);
  entry.crossSheetReferences = resolvedReferences.map((reference) => ({
    referencedDrawingNumber: reference.referencedDrawingNumber,
    resolvedTargetDocumentId: reference.resolvedTargetDocumentId,
    status: reference.status,
    applicableSystem: reference.applicableSystem,
    applicabilityStatus: reference.applicabilityStatus,
  }));
  entry.resolvedReferenceCount = resolvedReferences.filter((r) => r.status === "Resolved").length;
  entry.unresolvedReferenceCount = resolvedReferences.filter((r) => r.status === "Unresolved").length;

  entry.engineerQuestions = [];
  if (entry.drawingType === "Unknown / Mixed") entry.engineerQuestions.push("Drawing type could not be confidently classified -- confirm manually.");
  if (entry.drawingNumber === "Not Found") entry.engineerQuestions.push("Drawing number could not be extracted -- confirm the title block is readable.");
  if (entry.governedStatusCounts.conflict > 0) entry.engineerQuestions.push(`${entry.governedStatusCounts.conflict} proposal(s) are in Conflict and need engineer resolution before pricing/selection.`);
  if (entry.unresolvedReferenceCount > 0) entry.engineerQuestions.push(`${entry.unresolvedReferenceCount} cross-sheet reference(s) could not be resolved to a real document -- confirm the referenced drawing exists in this project's register.`);

  // WORKSTREAM 11's own required extraction-coverage verdict per sheet.
  const expectsGeneralPattern = entry.drawingType === "Detail / Enlarged Detail" || entry.drawingType === "Schedule";
  const producedTypeSpecific = Object.values(typeSpecific.proposalCounts).some((count) => count > 0);
  const producedGeneral = entry.equipmentSchedulesDetected > 0 || entry.callouts > 0;
  entry.extractionCoverageVerdict =
    producedTypeSpecific || producedGeneral || (!expectsGeneralPattern && entry.drawingType !== "Unknown / Mixed")
      ? "Coverage as expected for this drawing type"
      : "No intelligence produced -- review whether this sheet's real content should have matched an extractor";

  entry.status = "Evaluated";
  report.documents.push(entry);
}

const evaluated = report.documents.filter((d) => d.status === "Evaluated");
report.totals = {
  documentsEvaluated: evaluated.length,
  documentsTotal: report.documents.length,
  byDrawingType: Object.fromEntries([...new Set(evaluated.map((d) => d.drawingType))].map((type) => [type, evaluated.filter((d) => d.drawingType === type).length])),
  totalProposals: evaluated.reduce((sum, d) => sum + d.proposalsExtracted, 0),
  totalGovernedStatusCounts: evaluated.reduce(
    (acc, d) => {
      for (const key of Object.keys(acc)) acc[key] += d.governedStatusCounts[key];
      return acc;
    },
    { verified: 0, verifiedWithAssumption: 0, needsReview: 0, conflict: 0, notFound: 0 },
  ),
  totalResolvedReferences: evaluated.reduce((sum, d) => sum + d.resolvedReferenceCount, 0),
  totalUnresolvedReferences: evaluated.reduce((sum, d) => sum + d.unresolvedReferenceCount, 0),
};

writeFileSync("docs/drawing-intelligence-set-report.json", JSON.stringify(report, null, 2));

const md = [];
md.push(`# Drawing Intelligence -- Al Mousa School Drawing Set Report`);
md.push(``);
md.push(`Generated: ${report.generatedAt}`);
md.push(`Engine version: ${report.engineVersion}`);
md.push(``);
md.push(`## Project totals`);
md.push(`- Documents evaluated: ${report.totals.documentsEvaluated} of ${report.totals.documentsTotal}`);
md.push(`- By drawing type: ${Object.entries(report.totals.byDrawingType).map(([type, count]) => `${type} (${count})`).join(", ")}`);
md.push(`- Total proposals extracted: ${report.totals.totalProposals}`);
md.push(
  `- Total governed status: ${report.totals.totalGovernedStatusCounts.verified} Verified, ${report.totals.totalGovernedStatusCounts.verifiedWithAssumption} Verified with Assumption, ${report.totals.totalGovernedStatusCounts.needsReview} Needs Review, ${report.totals.totalGovernedStatusCounts.conflict} Conflict, ${report.totals.totalGovernedStatusCounts.notFound} Not Found`,
);
md.push(`- Cross-sheet references: ${report.totals.totalResolvedReferences} resolved, ${report.totals.totalUnresolvedReferences} unresolved`);
md.push(``);
for (const entry of report.documents) {
  md.push(`## ${entry.name}`);
  md.push(`- Document id: ${entry.documentId}`);
  md.push(`- Document type: ${entry.documentType}`);
  md.push(`- Status: ${entry.status}`);
  if (entry.status !== "Evaluated") {
    md.push(``);
    continue;
  }
  md.push(`- Drawing number: ${entry.drawingNumber} | Revision: ${entry.revision} | Sheet name: ${entry.sheetName}`);
  md.push(`- Drawing type: ${entry.drawingType} (${entry.drawingTypeConfidence}% -- ${entry.drawingTypeEvidence})`);
  md.push(`- Primary intelligence types expected: ${entry.primaryIntelligenceTypesExpected.join(", ") || "General schedule/callout pattern only"}`);
  md.push(`- Type-specific proposals: ${JSON.stringify(entry.typeSpecificProposals)}`);
  md.push(`- Equipment schedule rows: ${entry.equipmentSchedulesDetected} | Equipment proposals: ${entry.equipmentProposals} | Panel candidates: ${entry.panelCandidates}`);
  md.push(`- Callouts: ${entry.callouts} (${entry.excludedCallouts} excluded as title-block metadata)`);
  md.push(`- Structural regions: ${entry.structuralRegions}`);
  md.push(
    `- Governed status: ${entry.governedStatusCounts.verified} Verified, ${entry.governedStatusCounts.verifiedWithAssumption} Verified with Assumption, ${entry.governedStatusCounts.needsReview} Needs Review, ${entry.governedStatusCounts.conflict} Conflict, ${entry.governedStatusCounts.notFound} Not Found`,
  );
  md.push(`- Cross-sheet references: ${entry.crossSheetReferences.map((r) => `${r.referencedDrawingNumber} (${r.status}${r.resolvedTargetDocumentId ? " -> " + r.resolvedTargetDocumentId : ""})`).join(", ") || "None"}`);
  md.push(`- Extraction coverage verdict: ${entry.extractionCoverageVerdict}`);
  if (entry.engineerQuestions.length) {
    md.push(`- Engineer questions:`);
    for (const question of entry.engineerQuestions) md.push(`  - ${question}`);
  }
  md.push(``);
}
writeFileSync("docs/drawing-intelligence-set-report.md", md.join("\n"));

console.log(`Wrote docs/drawing-intelligence-set-report.json and .md`);
console.log(`Evaluated ${evaluated.length} of ${report.documents.length} documents.`);
console.log(JSON.stringify(report.totals, null, 2));
