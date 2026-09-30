// STAGE4-CI1 -- Drawing Architecture Bridge CONSUMER integration (read side).
//
// The producer bridge (drawing-architecture-bridge.mjs, endpoint
// GET /api/projects/:id/drawing-architecture/bridge) is closed and must not
// change. This module is the single Stage 4 consumer contract: it converts a
// produced bridge projection into the governed `drawingArchitectureContext`
// namespace carried on the requirement profile (Stage 4 inputs).
//
// Semantic boundary (permanent):
//   PROJECT ARCHITECTURE EVIDENCE != PRODUCT CAPABILITY
//   PROJECT ARCHITECTURE EVIDENCE != PRODUCT COMPATIBILITY
//   CIRCUIT_BUS != PROTOCOL (SLC != FlashScan != CLIP != IDP)
//   PANEL_NETWORK != product interoperability
//   SYSTEM_INTERFACE != product compatibility
//
// The context is project-architecture context only. It is never flattened
// into requirements[] / compatibility[] / attributes[] / standards[], never
// feeds runProductMatching comparisons, and never touches Product Library,
// Drawing, pricing, or quotation state. Read-only by construction: pure
// functions over the already-produced projection, zero writes.
export const STAGE4_DRAWING_ARCHITECTURE_CONTEXT_VERSION = "stage4-drawing-architecture-context-1.0.0";

// The governed readiness value that authorizes Stage 4 consumption. Any other
// readiness (including unrecorded) means the context is unavailable -- Stage 4
// remains usable, nothing is fabricated, nothing fails.
export const STAGE4_CONSUMABLE_READINESS = "READY_FOR_STAGE4_BRIDGE";

export const DRAWING_ARCHITECTURE_CONTEXT_UNAVAILABLE = "DRAWING_ARCHITECTURE_UNAVAILABLE";

const channelIds = () => ["PANEL_INVENTORY", "CIRCUIT_BUS", "PANEL_NETWORK", "SYSTEM_INTERFACE", "NAC_CIRCUIT", "AREA_COVERAGE", "LEGEND_LINKAGE", "CROSS_SHEET_RESOLUTION"];

const emptyChannels = () => Object.fromEntries(channelIds().map((id) => [id, { count: 0, evidence: [] }]));

// Canonical unavailable shape. Returned whenever there is no consumable
// bridge (none produced, superseded without replacement, readiness not
// consumable, or loader failure). Stage 4 treats this as ordinary missing
// context: usable, non-blocking, never fabricated.
export const emptyDrawingArchitectureContext = (reason = DRAWING_ARCHITECTURE_CONTEXT_UNAVAILABLE) => ({
  version: STAGE4_DRAWING_ARCHITECTURE_CONTEXT_VERSION,
  available: false,
  reason,
  architectureVersion: null,
  status: null,
  readiness: null,
  channels: emptyChannels(),
  evidenceCount: 0,
  adjudications: [],
  unresolved: [],
  fingerprint: null,
  provenance: null,
});

// Build the Stage 4 consumer context from an already-produced bridge
// projection (buildDrawingArchitectureBridge output) or null. Pure and
// idempotent: the same bridge object always yields a deep-equal context.
// Evidence rows are grouped by their governed consumer channel with row
// objects preserved intact (provenance, adjudication, fingerprints) -- 128
// rows in remain exactly 128 rows out; nothing is re-typed, re-valued, or
// promoted into requirement/product surface.
export const buildStage4DrawingArchitectureContext = (bridge) => {
  if (!bridge || typeof bridge !== "object" || bridge.current !== true) {
    return emptyDrawingArchitectureContext(bridge?.status === "NO_CURRENT_ARCHITECTURE_VERSION" ? "NO_CURRENT_ARCHITECTURE_VERSION" : DRAWING_ARCHITECTURE_CONTEXT_UNAVAILABLE);
  }
  if (!Number.isInteger(bridge.architectureVersion)) {
    return emptyDrawingArchitectureContext("ARCHITECTURE_VERSION_UNRESOLVED");
  }
  if (bridge.status !== STAGE4_CONSUMABLE_READINESS) {
    return emptyDrawingArchitectureContext(`READINESS_NOT_CONSUMABLE:${bridge.status || "UNRECORDED"}`);
  }
  const channels = emptyChannels();
  for (const entry of bridge.evidence || []) {
    const channel = entry?.downstreamConsumer;
    if (!channels[channel]) continue;
    channels[channel].evidence.push(entry);
  }
  for (const id of channelIds()) channels[id] = { count: channels[id].evidence.length, evidence: channels[id].evidence };
  const evidenceCount = channelIds().reduce((sum, id) => sum + channels[id].count, 0);
  return {
    version: STAGE4_DRAWING_ARCHITECTURE_CONTEXT_VERSION,
    available: true,
    reason: null,
    architectureVersion: bridge.architectureVersion,
    status: bridge.status,
    readiness: bridge.readiness || null,
    channels,
    evidenceCount,
    adjudications: Array.isArray(bridge.adjudications) ? bridge.adjudications : [],
    unresolved: Array.isArray(bridge.unresolved) ? bridge.unresolved : [],
    fingerprint: bridge.fingerprint || null,
    provenance: {
      bridgeSemanticVersion: bridge.semanticVersion || null,
      readFromVersionId: bridge.readFromVersionId || null,
      approvedFactCount: Number(bridge.approvedFactCount ?? evidenceCount),
      nonBridgedFactTypes: Array.isArray(bridge.nonBridgedFactTypes) ? bridge.nonBridgedFactTypes : [],
    },
  };
};

// Normalize whatever the profile builder receives (bridge output, an
// already-built context, null/undefined) into the canonical context shape.
// Guarantees every profile carries a well-formed drawingArchitectureContext,
// so consumers never branch on its absence.
export const normalizeStage4DrawingArchitectureContext = (value) => {
  if (!value || typeof value !== "object") return emptyDrawingArchitectureContext();
  if (value.version === STAGE4_DRAWING_ARCHITECTURE_CONTEXT_VERSION && typeof value.available === "boolean") return value;
  return buildStage4DrawingArchitectureContext(value);
};
