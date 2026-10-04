// STAGE 4 DRAWING BRIDGE -- governed projection of approved Drawing
// Architecture evidence onto the Stage 4 project-evidence surface.
//
// This module is the ONLY gate through which governed Drawing Architecture
// v2 facts (0078 approved rows + 0079 exception adjudications + stage-4
// readiness) become project-side technical EVIDENCE for the Stage 4
// requirement / profile pipeline. It is a READ-ONLY projection:
//
//   * it never writes, never creates new engineering facts, and never
//     duplicates the architecture records into a second knowledge store --
//     the existing governed records ARE the store, reused unchanged;
//   * it never feeds the product-matching / compatibility channel:
//     SLC circuit-bus, panel-network, interface, and cross-sheet relations
//     remain PROJECT ARCHITECTURE EVIDENCE (DRAWING PROJECT EVIDENCE), never
//     PRODUCT CAPABILITY / PROTOCOL COMPATIBILITY;
//   * unresolved drawing evidence stays UNKNOWN_PROJECT (non-blocking),
//     never FAIL;
//   * repeated evaluation is deterministic and fingerprint-idempotent.
//
// Hard invariants (proven by tests/Drawing-architecture-stage4-bridge.test.mjs):
//   1. Only the CURRENT (non-superseded) approved architecture version is
//      consumable; a superseded version is never projected as evidence.
//   2. Provenance survives the bridge: drawing, sheet, source evidence,
//      architecture version, and adjudication decision ride on every entry.
//   3. Unresolved drawing evidence stays non-blocking (UNKNOWN_PROJECT).
//   4. SLC is CIRCUIT_BUS project architecture evidence, not a protocol;
//      panel relationships are architecture evidence, not product
//      compatibility. No FlashScan/CLIP/compatibility vocabulary is ever
//      emitted.
//   5. Repeated bridge evaluation is idempotent (stable fingerprint).
//
// The bridge does not rewrite production semantics: product matching never
// reads this projection, and Golden / Product Library surfaces are untouched.

export const DRAWING_ARCHITECTURE_BRIDGE_VERSION = "drawing-architecture-bridge-1.0.0";
export const DRAWING_ARCHITECTURE_BRIDGE_SEMANTIC_VERSION = "drawing-architecture-bridge-semantics-1.0.0";
export const BRIDGE_NO_CURRENT_VERSION = "NO_CURRENT_ARCHITECTURE_VERSION";
export const UNRESOLVED_EVIDENCE_POLICY = "UNKNOWN_PROJECT";
export const MATCHING_ROLE = "project-architecture-context";

// ---------------------------------------------------------------------------
// Governed evidence taxonomy: every bridged fact type maps to EXACTLY one
// explicit downstream consumer channel of the Stage 4 pipeline. A channel is
// project-architecture context -- it is never product capability and never
// protocol compatibility.
// ---------------------------------------------------------------------------
export const BRIDGE_CONSUMER_CHANNELS = Object.freeze({
  PANEL_INVENTORY: Object.freeze({
    id: "PANEL_INVENTORY",
    consumer: "Stage 4 panel identity / system confirmation context",
    productCompatibility: false,
    protocol: false,
  }),
  CIRCUIT_BUS: Object.freeze({
    id: "CIRCUIT_BUS",
    consumer: "Stage 4 circuit-bus (SLC loop) addressing topology context",
    productCompatibility: false,
    protocol: false,
  }),
  PANEL_NETWORK: Object.freeze({
    id: "PANEL_NETWORK",
    consumer: "Stage 4 panel-to-panel network topology context",
    productCompatibility: false,
    protocol: false,
  }),
  SYSTEM_INTERFACE: Object.freeze({
    id: "SYSTEM_INTERFACE",
    consumer: "Stage 4 external system interface boundary context",
    productCompatibility: false,
    protocol: false,
  }),
  NAC_CIRCUIT: Object.freeze({
    id: "NAC_CIRCUIT",
    consumer: "Stage 4 notification appliance circuit context",
    productCompatibility: false,
    protocol: false,
  }),
  AREA_COVERAGE: Object.freeze({
    id: "AREA_COVERAGE",
    consumer: "Stage 4 area / zone coverage context",
    productCompatibility: false,
    protocol: false,
  }),
  LEGEND_LINKAGE: Object.freeze({
    id: "LEGEND_LINKAGE",
    consumer: "Stage 4 symbol-to-legend linkage provenance",
    productCompatibility: false,
    protocol: false,
  }),
  CROSS_SHEET_RESOLUTION: Object.freeze({
    id: "CROSS_SHEET_RESOLUTION",
    consumer: "Stage 4 cross-sheet reference resolution provenance",
    productCompatibility: false,
    protocol: false,
  }),
});

// fact_type -> consumer channel id. ARCHITECTURE_DISCREPANCY is deliberately
// ABSENT: discrepancies are review artifacts folded 1:1 into their
// CROSS_SHEET_REFERENCE exception (Step 14.8 design) and are surfaced only as
// non-blocking unresolved context -- never bridged as evidence itself.
export const BRIDGE_FACT_SEMANTICS = Object.freeze({
  PANEL_EXISTS: "PANEL_INVENTORY",
  PANEL_LABEL: "PANEL_INVENTORY",
  SLC_LOOP_EXISTS: "CIRCUIT_BUS",
  PANEL_LOOP_RELATION: "CIRCUIT_BUS",
  SLC_LOOP_SERVES_AREA: "CIRCUIT_BUS",
  SLC_DEVICE_BRANCH: "CIRCUIT_BUS",
  NAC_CIRCUIT_EXISTS: "NAC_CIRCUIT",
  PANEL_SERVES_AREA: "AREA_COVERAGE",
  PANEL_NETWORK_LINK: "PANEL_NETWORK",
  FIRE_ALARM_NETWORK_TOPOLOGY: "PANEL_NETWORK",
  INTERFACE_CONNECTED_TO_SYSTEM: "SYSTEM_INTERFACE",
  EXTERNAL_SYSTEM_INTERFACE: "SYSTEM_INTERFACE",
  LAYOUT_LEGEND_LINK: "LEGEND_LINKAGE",
  CROSS_SHEET_REFERENCE: "CROSS_SHEET_RESOLUTION",
});

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";

const text = (value) => String(value ?? "").trim();
const normalizeDrawingNumber = (value) => text(value).replace(/\s+/g, " ").replace(/^"|"$/g, "");

const sha256hex = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

const canonicalStringify = (value) => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const bridgeSemanticsFor = (factType) => {
  const channelId = BRIDGE_FACT_SEMANTICS[factType];
  if (!channelId) return null;
  const channel = BRIDGE_CONSUMER_CHANNELS[channelId];
  return {
    factType,
    downstreamConsumer: channel.id,
    consumer: channel.consumer,
    productCompatibility: channel.productCompatibility,
    protocol: channel.protocol,
    matchingRole: MATCHING_ROLE,
  };
};

// Resolve the ACTIVE adjudication that governs a specific approved row:
//   1) exact review-case linkage: the row's review_case_id is one of the
//      adjudication's resolved source review cases (primary + mirrored);
//   2) sheet-level fallback for generic FACP identity: a PANEL_EXISTS FACP
//      row on the same source sheet as a GENERIC_FACP_IDENTITY adjudication.
export const adjudicationForRow = (row, adjudications = []) => {
  const rowSheet = normalizeDrawingNumber(row.sourceDrawingNumber);
  const byCase = (adjudications || []).find((entry) => (entry.reviewCaseIds || []).includes(row.reviewCaseId));
  if (byCase) return byCase;
  if (row.factType === "PANEL_EXISTS" && text(row.subject) === "FACP") {
    return (adjudications || []).find((entry) => entry.exceptionType === "GENERIC_FACP_IDENTITY" && normalizeDrawingNumber(entry.sourceDrawingNumber) === rowSheet) || null;
  }
  return null;
};

// ---------------------------------------------------------------------------
// The projection. Input shapes (produced by the worker's loaders):
//   approvedVersion : loadApprovedVersion output (camelCase) or null
//   adjudications   : loadAdjudications output (camelCase) or []
//   readinessRow    : single raw drawing_architecture_stage4_readiness row
//                     (snake_case) or null
//   unresolvedCases : raw drawing_architecture_review_cases rows that are not
//                     Approved (snake_case) or []
// ---------------------------------------------------------------------------
export const projectArchitectureEvidence = ({ approvedVersion, adjudications = [], readinessRow = null, unresolvedCases = [] }) => {
  if (!approvedVersion) {
    return {
      current: false,
      status: BRIDGE_NO_CURRENT_VERSION,
      semanticVersion: DRAWING_ARCHITECTURE_BRIDGE_SEMANTIC_VERSION,
      architectureVersion: null,
      evidence: [],
      adjudications: (adjudications || []).map(adjudicationSummary),
      unresolved: (unresolvedCases || []).map(unresolvedSummary),
      readiness: null,
      nonBridgedFactTypes: ["ARCHITECTURE_DISCREPANCY"],
      fingerprint: sha256hex(canonicalStringify({
        semanticVersion: DRAWING_ARCHITECTURE_BRIDGE_SEMANTIC_VERSION,
        architectureVersion: null,
        evidence: [],
        adjudications: (adjudications || []).map(adjudicationSummary),
        unresolved: (unresolvedCases || []).map(unresolvedSummary),
      })),
    };
  }

  const rows = [...(approvedVersion.approvedRows || [])].sort((left, right) =>
    `${left.factType}\u0000${left.sourceDrawingNumber || ""}\u0000${left.id || ""}`.localeCompare(`${right.factType}\u0000${right.sourceDrawingNumber || ""}\u0000${right.id || ""}`),
  );

  const evidence = [];
  const nonBridged = [];
  for (const row of rows) {
    const semantics = bridgeSemanticsFor(row.factType);
    if (!semantics) {
      nonBridged.push({ factType: row.factType, id: row.id, reason: "No governed Stage 4 downstream consumer channel for this fact type." });
      continue;
    }
    const adjudication = adjudicationForRow(row, adjudications);
    evidence.push({
      id: row.id,
      reviewCaseId: row.reviewCaseId,
      factType: row.factType,
      subject: row.subject,
      relation: row.relation ?? null,
      object: row.object ?? null,
      scope: row.scope,
      evidenceKind: row.evidenceKind,
      authorityClass: row.authorityClass ?? null,
      downstreamConsumer: semantics.downstreamConsumer,
      consumer: semantics.consumer,
      productCompatibility: semantics.productCompatibility,
      protocol: semantics.protocol,
      matchingRole: semantics.matchingRole,
      architectureVersion: Number(approvedVersion.version),
      provenance: {
        documentId: row.documentId ?? null,
        documentVersionId: row.documentVersionId ?? null,
        sourceDrawingNumber: row.sourceDrawingNumber ?? null,
        sourcePage: row.sourcePage ?? null,
        sourceRegion: row.sourceRegion ?? null,
        sourceFragmentIds: row.sourceFragmentIds || [],
        evidenceFingerprint: row.evidenceFingerprint ?? null,
        parserVersion: row.parserVersion ?? null,
        reviewActorId: row.reviewActorId ?? null,
        reviewReason: row.reviewReason ?? null,
      },
      adjudication: adjudication
        ? {
            exceptionKey: adjudication.exceptionKey ?? null,
            decisionState: adjudication.decisionState ?? null,
            decisionPolicyVersion: adjudication.decisionPolicyVersion ?? null,
            stage4BlockingClass: adjudication.stage4BlockingClass ?? null,
            canonicalTargetDrawingNumber: adjudication.canonicalTargetDrawingNumber ?? null,
            canonicalPanelIdentity: adjudication.canonicalPanelIdentity ?? null,
            canonicalBuildingAssetCode: adjudication.canonicalBuildingAssetCode ?? null,
          }
        : null,
    });
  }

  const unresolved = (unresolvedCases || []).map(unresolvedSummary);
  const output = {
    current: true,
    status: readinessRow?.stage4_readiness ?? "STAGE4_READINESS_UNRECORDED",
    semanticVersion: DRAWING_ARCHITECTURE_BRIDGE_SEMANTIC_VERSION,
    architectureVersion: Number(approvedVersion.version),
    approvedFactCount: Number(approvedVersion.approvedFactCount ?? evidence.length),
    readFromVersionId: approvedVersion.approvedVersionId ?? null,
    evidence,
    adjudications: (adjudications || []).map(adjudicationSummary),
    unresolved,
    nonBridgedFactTypes: nonBridged.length ? [...new Set(nonBridged.map((entry) => entry.factType))] : [],
    readiness: readinessRow
      ? readinessSummary(readinessRow)
      : null,
    fingerprint: null,
  };
  output.fingerprint = sha256hex(canonicalStringify({
    semanticVersion: output.semanticVersion,
    architectureVersion: output.architectureVersion,
    evidence: evidence.map((entry) => canonicalEntry(entry)),
    adjudications: output.adjudications,
    unresolved,
  }));
  return output;
};

const canonicalEntry = (entry) => ({
  id: entry.id,
  factType: entry.factType,
  subject: entry.subject,
  relation: entry.relation,
  object: entry.object,
  downstreamConsumer: entry.downstreamConsumer,
  productCompatibility: entry.productCompatibility,
  protocol: entry.protocol,
  architectureVersion: entry.architectureVersion,
  provenance: entry.provenance,
  adjudication: entry.adjudication,
});

const adjudicationSummary = (entry) => ({
  exceptionKey: entry.exceptionKey ?? null,
  exceptionType: entry.exceptionType ?? null,
  sourceDrawingNumber: entry.sourceDrawingNumber ?? null,
  decisionState: entry.decisionState ?? null,
  decisionPolicyVersion: entry.decisionPolicyVersion ?? null,
  canonicalTargetDrawingNumber: entry.canonicalTargetDrawingNumber ?? null,
  canonicalPanelIdentity: entry.canonicalPanelIdentity ?? null,
  canonicalBuildingAssetCode: entry.canonicalBuildingAssetCode ?? null,
  stage4BlockingClass: entry.stage4BlockingClass ?? null,
});

const unresolvedSummary = (row) => ({
  id: row.id,
  factType: row.fact_type,
  subject: row.subject,
  relation: row.relation ?? null,
  object: row.object ?? null,
  sourceDrawingNumber: row.source_drawing_number ?? null,
  sourcePage: row.source_page ?? null,
  status: row.status,
  policy: UNRESOLVED_EVIDENCE_POLICY, // UNKNOWN_PROJECT, never FAIL
  blocking: false,
});

const readinessSummary = (row) => ({
  architectureStatus: row.architecture_status ?? null,
  stage4Readiness: row.stage4_readiness ?? null,
  stage4BlockingClassSummary: row.stage4_blocking_class_summary ?? null,
  uniqueExceptionCount: Number(row.unique_exception_count ?? 0),
  resolvedCount: Number(row.resolved_count ?? 0),
  approvedNextVersionNumber: Number(row.approved_next_version_number ?? 0),
  approvedNextRowCount: Number(row.approved_next_row_count ?? 0),
  policyVersion: row.policy_version ?? null,
  computedBy: row.computed_by ?? null,
  evidenceFingerprint: row.evidence_fingerprint ?? null,
});

// Convenience wrapper matching the worker's loader composition. Deterministic:
// the same governed records produce the same projection and the same
// fingerprint, so repeated evaluation is idempotent by construction.
export const buildDrawingArchitectureBridge = ({ approvedVersion, adjudications = [], readinessRow = null, unresolvedCases = [] }) =>
  projectArchitectureEvidence({ approvedVersion, adjudications, readinessRow, unresolvedCases });