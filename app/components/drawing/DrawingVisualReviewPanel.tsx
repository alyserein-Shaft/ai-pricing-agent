import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  buildDrawingOverlayItems,
  filterDrawingOverlayItems,
  highlightVerificationMode,
  verifyTextTagHighlight,
  DRAWING_OVERLAY_SOURCE_TYPES,
} from "../../domain/drawing-overlay-view-model.mjs";
import type { DrawingOverlayItem } from "../../domain/drawing-overlay-view-model.d.mts";
import { mapCanonicalBoxToViewport } from "../../domain/drawing-coordinate-mapper.mjs";
import { buildGeneralDrawingExtractionProposals } from "../../domain/drawing-general-extraction-engine.mjs";
import {
  buildGeneralExtractionOverlayItems,
  GENERAL_EXTRACTION_SOURCE_TYPES,
} from "../../domain/drawing-general-extraction-view-model.mjs";
import type { GeneralExtractionOverlayItem } from "../../domain/drawing-general-extraction-view-model.d.mts";
import {
  buildDrawingIntelligenceProposals,
  buildDrawingIntelligenceOverlayItems,
  DRAWING_INTELLIGENCE_SOURCE_TYPES,
  DEFAULT_VISIBLE_SOURCE_TYPES,
} from "../../domain/drawing-intelligence-view-model.mjs";
import type { DrawingIntelligenceOverlayItem } from "../../domain/drawing-intelligence-view-model.d.mts";
import { buildDrawingUnderstandingSummary, buildDrawingAttention } from "../../domain/drawing-understanding-summary.mjs";
import { computeComplementaryCropRegions } from "../../domain/drawing-crop-selection.mjs";
import { CANDIDATE_COMPARISON_PILOT_CASES, CANDIDATE_COMPARISON_PILOT_DOCUMENT_IDS } from "../../domain/candidate-comparison-pilot-cases.mjs";
import { EmptyState, ErrorState } from "../shared/WorkspaceStates";

// AI visual understanding source types (Source-Backed Drawing Understanding
// pilot) -- these proposals only ever exist PERSISTED (drawing_extraction_
// proposals, written by POST .../drawing-extraction/visual-analysis), never
// recomputed client-side like the deterministic families above, since only
// a real model call can produce them. See buildAiOverlayItems below.
const AI_VISUAL_SOURCE_TYPES = ["AiEquipment", "AiCircuit", "AiCableSpec", "AiInterface", "AiCrossSheetRef", "AiQuantity", "AiFinding"];
// Mirrors app/domain/drawing-visual-understanding-contract.mjs's
// SOURCE_TYPE_BY_CATEGORY (a persisted proposal's evidence.category); kept
// as a small display-only copy here rather than importing a worker-side
// constant into a client component.
const AI_SOURCE_TYPE_BY_CATEGORY: Record<string, string> = {
  equipment: "AiEquipment",
  circuits: "AiCircuit",
  cableSpecs: "AiCableSpec",
  interfaces: "AiInterface",
  crossSheetReferences: "AiCrossSheetRef",
  quantities: "AiQuantity",
};

const ALL_OVERLAY_SOURCE_TYPES = [
  ...DRAWING_OVERLAY_SOURCE_TYPES,
  ...GENERAL_EXTRACTION_SOURCE_TYPES,
  ...DRAWING_INTELLIGENCE_SOURCE_TYPES,
  ...AI_VISUAL_SOURCE_TYPES,
];
// "Do not overload the PDF with everything visible at once" -- Text/
// Symbol/UnknownSymbol/Structure/Equipment/Callout stay default-on
// (already-established v0 behavior); the newer intelligence families
// default per DEFAULT_VISIBLE_SOURCE_TYPES (noisy ones -- General Notes,
// bare Device Codes, Matrix Headers -- start OFF, toggleable). AI findings
// default ON -- there is no client-side recomputation for a user to fall
// back on, so hiding them by default would make a real analysis run look
// like it found nothing.
const DEFAULT_ACTIVE_SOURCE_TYPES = [
  ...DRAWING_OVERLAY_SOURCE_TYPES,
  ...GENERAL_EXTRACTION_SOURCE_TYPES,
  ...DEFAULT_VISIBLE_SOURCE_TYPES,
  ...AI_VISUAL_SOURCE_TYPES,
];

// Every proposal-shaped sourceType supports the same governed review
// actions except CrossSheetRef (evidence about a relationship, not itself
// a proposal to approve/reject) -- matching the existing Text exclusion. AI
// findings go through the exact same review action on the exact same
// persisted table -- no separate AI review path.
const REVIEWABLE_SOURCE_TYPES: string[] = [
  ...GENERAL_EXTRACTION_SOURCE_TYPES,
  ...DRAWING_INTELLIGENCE_SOURCE_TYPES.filter((type) => type !== "CrossSheetRef"),
  ...AI_VISUAL_SOURCE_TYPES.filter((type) => type !== "AiCrossSheetRef"),
];

// The Visual Review canvas/inspector treats every evidence source
// uniformly once normalized to this shape -- see DrawingOverlayItem
// (existing Text/Symbol/UnknownSymbol/Structure evidence),
// GeneralExtractionOverlayItem (Equipment/Callout proposals), and
// DrawingIntelligenceOverlayItem (Legend/Riser/Layout/Cause & Effect/
// Detail proposals -- product integration pass).
// Same shape as DrawingIntelligenceOverlayItem, except sourceType/
// drawingType are widened: an AI visual finding's sourceType is one of the
// new "Ai*" strings (not part of DrawingIntelligenceSourceType, which
// enumerates only the deterministic engines' source types), and its
// drawingType is legitimately null -- an AI finding is not scoped to one
// of the deterministic type-specific families the way every intelligence
// engine's own proposals are.
type AiVisualOverlayItem = Omit<DrawingIntelligenceOverlayItem, "sourceType" | "drawingType"> & {
  sourceType: string;
  drawingType: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewReason?: string | null;
};

type OverlayItem = DrawingOverlayItem | GeneralExtractionOverlayItem | DrawingIntelligenceOverlayItem | AiVisualOverlayItem;

// Each extraction engine writes its own keys into `evidence` (see the readers
// below), so this boundary is genuinely open-shaped. Naming it once keeps the
// view from repeating the cast, and matches the allowance app/page.tsx already
// declares for the same dynamic read-model boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EvidenceRecord = Record<string, any>;
// Every overlay item's sourceEntity carries at least a stable id, and the ones
// that came from another document also carry that document's id.
type OverlaySourceEntity = { id: string; documentId?: string };

type ReviewOverride = {
  reviewStatus: string;
  reviewedAt?: string;
  reviewedBy?: string | null;
  reviewReason?: string | null;
  correctedValue?: unknown;
};

// AUTOMATIC-ASSISTED DRAWING REVIEW v0.
//
// This panel is the VISUAL half of the existing, already-governed Drawing
// Review surface (Drawing Intake / Structural Parser / Symbol Recognition).
// It renders the real page PDF.js-side and overlays the SAME evidence the
// existing Assets/Occurrences/Regions tabs already show as tables -- it
// creates no new evidence and no new review state.
//
// DETECTED != INTERPRETED != APPROVED: every overlay item here is drawn
// from a "Needs Review"/"Approved"/"Rejected" governed record that already
// exists. Approving/rejecting/restoring/reassigning a Symbol Occurrence
// from the inspector below calls the exact same `onSymbolAction` handler
// (reviewSymbol) the existing Symbol Review tab already uses -- no new
// backend action is invented. Structural regions have no per-region review
// action of their own in the existing API (structural review works over
// review "cases", not individual regions), so their inspector links out to
// the existing, real Structure Review overlay instead of faking one.
//
// Coordinate math is never inlined here -- every overlay box's screen
// position comes from mapCanonicalBoxToViewport (drawing-coordinate-
// mapper.mjs), the one place that owns the canonical (bottom-left, y-up)
// -> canvas (top-left, y-down) conversion.
type DrawingPage = { id: string; page_number: number; width: number; height: number; rotation?: number };

const SOURCE_TYPE_LABELS: Record<string, string> = {
  Text: "Text",
  Symbol: "Symbols",
  UnknownSymbol: "Unknown",
  Structure: "Structure",
  Equipment: "Equipment",
  Callout: "Callouts",
  Legend: "Legend Defs",
  Note: "General Notes",
  Loop: "Loops",
  Cable: "Cable Specs",
  Interface: "System Interfaces",
  Connection: "Possible Connections",
  DeviceCode: "Device Codes",
  Placement: "Device Placements",
  DetailRef: "Detail References",
  MatrixHeader: "Matrix Headers",
  MatrixRelation: "Matrix Relationships",
  Installation: "Installation Reqs",
  DetailNumber: "Detail Numbers",
  CrossSheetRef: "Cross-Sheet Refs",
  AiEquipment: "AI: Equipment",
  AiCircuit: "AI: Circuits",
  AiCableSpec: "AI: Cable Specs",
  AiInterface: "AI: Interfaces",
  AiCrossSheetRef: "AI: Cross-Sheet Refs",
  AiQuantity: "AI: Quantities",
  AiFinding: "AI: Summary",
};

// Continuous scale (replacing the old fixed 0.15..1.5 step ladder, whose
// 0.3x default stranded a sheet-size drawing in a mostly-blank viewport).
// The default is a real fit computed from the page's own PDF.js viewport and
// the measured size of the viewer area -- never a guessed content bound.
const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const SCALE_STEP = 1.25;
const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
// Padding inside the viewer area so a fitted page is not flush to the border.
const FIT_PADDING = 20;
// Upper bound on loading a drawing's source PDF before the viewer reports a
// real failure instead of spinning indefinitely (see the render effect).
const DOCUMENT_LOAD_TIMEOUT_MS = 45000;

type ZoomRequest = { mode: "fit-page" | "fit-width" | "manual"; value: number };

// An automatic (extraction-time) status is not an engineering decision, and
// must not read like one. Each entry restates the SAME stored status in words
// that name its real scope; the stored value itself is always shown in the
// finding's details, never replaced.
const AUTOMATIC_STATUS_PRESENTATION: Record<string, { label: string; tone: string; scope: string }> = {
  Verified: {
    label: "Text detected",
    tone: "detected",
    scope:
      "Extraction found this value stated explicitly in the source, on a drawing type that is the recognised authority for this kind of fact, with no hard-review trigger. That is an extraction result, not an engineering approval.",
  },
  "Verified with Assumption": {
    label: "Text detected (assumption recorded)",
    tone: "detected",
    scope:
      "Stated in the source, but stored with an explicit assumption attached. That is an extraction result, not an engineering approval.",
  },
  "Needs Review": {
    label: "Awaiting review",
    tone: "pending",
    scope: "Extracted and stored. No engineer has reviewed it yet.",
  },
  Conflict: {
    label: "Conflict",
    tone: "conflict",
    scope: "Stored with a Conflict status. The value is not settled.",
  },
  "Not Found": {
    label: "Not found",
    tone: "muted",
    scope: "Recorded as not found in the source.",
  },
};


// Module scope on purpose: a component declared inside the panel would be a
// new type on every parent render, remounting these figures and throwing away
// the engineer's per-image zoom.
function ComparisonImage({
  src,
  alt,
  caption,
  provenance,
}: {
  src: string;
  alt: string;
  caption: string;
  provenance: { documentId?: string; pageNumber?: number } | undefined;
}) {
  // Independent zoom per side: the two crops come from different sheets at
  // different render scales, so a shared zoom would misrepresent one of them.
  // The viewports are equal-sized and the image is contained, never cropped or
  // stretched -- external qualifiers stay inside the frame.
  const [scale, setScale] = useState(1);
  return (
    <figure className="dwx-comparison-figure">
      <figcaption>{caption}</figcaption>
      <div className="dwx-comparison-viewport">
        <img alt={alt} src={src} style={{ transform: `scale(${scale})` }} />
      </div>
      <div className="dwx-comparison-zoom">
        <button type="button" onClick={() => setScale((value) => Math.max(1, Number((value - 0.5).toFixed(2))))} disabled={scale <= 1} aria-label={`Zoom out ${caption}`}>
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => setScale((value) => Math.min(6, Number((value + 0.5).toFixed(2))))} disabled={scale >= 6} aria-label={`Zoom in ${caption}`}>
          +
        </button>
      </div>
      <small>
        {provenance?.documentId ? `Source document ${provenance.documentId}` : "Source document not recorded"}
        {provenance?.pageNumber ? ` · page ${provenance.pageNumber}` : ""}
      </small>
    </figure>
  );
}

export function DrawingVisualReviewPanel(props: {
  documentId: string;
  pages: DrawingPage[];
  assets: Array<Record<string, any>>;
  occurrences: Array<Record<string, any>>;
  regions: Array<Record<string, any>>;
  onSymbolAction: (kind: "definitions" | "occurrences", entityId: string, action: string) => void;
  onOpenStructureReview: () => void;
  // WORKSTREAM 6 / PRODUCT INTEGRATION: governed review actions for
  // General Drawing Extraction (Equipment/Callout) AND the newer Legend/
  // Riser/Layout/Cause & Effect/Detail intelligence families alike --
  // overlayItemId is the same stable id both view-models produce. The
  // caller syncs it to a real persisted drawing_extraction_proposals row
  // (keyed by that same id as proposal_key) before acting, exactly like
  // onSymbolAction already resolves a real backend entity.
  onGeneralExtractionAction?: (overlayItemId: string, action: "approve" | "reject" | "correct" | "conflict" | "restore") => void;
  // Review state overrides (keyed by overlay item id) reflecting an
  // engineer's actual persisted decision -- populated both from actions
  // taken this session AND (on workspace open) fetched from the persisted
  // API, so a reload still shows the real review state, not just the
  // freshly-computed default.
  generalExtractionReviewOverrides?: Record<string, ReviewOverride>;
  // Drawing-type-specific intelligence context (WORKSTREAM 1-6, product
  // integration pass) -- classifications/legendEntries/drawingNumber/
  // sheetName/revision are the SAME already-fetched Drawing Intake context
  // (documentClassifications, legends[0].entries, metadata) the rest of
  // the Drawing Workspace already loads; nothing new is fetched here.
  classifications?: Array<{ type: string; confidence: number }>;
  legendEntries?: Array<Record<string, any>>;
  drawingNumber?: string | null;
  sheetName?: string | null;
  revision?: string | null;
  // Source-Backed Drawing Understanding pilot: the real persisted AI
  // visual-analysis proposals for this document (already-hydrated rows
  // from GET .../drawing-extraction, pre-filtered by the caller to this
  // document's AI-sourced ones) -- these can only ever come from the
  // server (a real model call), never recomputed here like the
  // deterministic families above.
  aiVisualFindings?: Array<Record<string, any>>;
  // The deterministic Cross-Sheet Reference engine's resolution fields
  // (resolvedTargetDocumentId/applicabilitySource/revisionCompatibility/
  // status) depend on the full project document registry, which this panel
  // never has (see drawingIntelligenceResult below, built with an
  // intentionally empty registry). Keyed by proposalKey, already filtered by
  // the caller to this document's current, non-superseded Cross-Sheet
  // Reference proposals only -- this is the real, server-computed outcome
  // (from worker/drawing-extraction-api.mjs's intelligenceContext), reused
  // here rather than silently overwritten by this panel's own empty-registry
  // recomputation. When a given reference has no entry here (sync never run,
  // or nothing persisted yet), the client recomputation's own honest
  // "no exact match" wording is shown unchanged -- never claims a fresh
  // server lookup happened when it did not.
  persistedCrossSheetResolutions?: Record<
    string,
    { resolvedTargetDocumentId: string | null; applicabilitySource: string | null; revisionCompatibility: string | null; status: string | null }
  >;
  // Called after a real visual-analysis POST completes successfully, so the
  // caller (which owns aiVisualFindings/generalExtractionReviewOverrides,
  // fetched once at Drawing Workspace open) can refetch and pass the new
  // findings back down -- this panel never owns that persisted state
  // itself, matching how every other proposal family here already works.
  onVisualAnalysisComplete?: () => void;

  // --- Drawing Workspace shell composition ---------------------------------
  // The workspace shell (app/page.tsx) still owns routing, the sheet-identity/
  // symbol-recognition/BOQ-impact datasets and the legacy intake index. It
  // passes them down as already-rendered content and already-derived attention
  // entries rather than this panel refetching or re-deriving any of it, so
  // nothing about which record governs what changes here.
  onClose?: () => void;
  // The ONE overall review-status label, computed by the shell from the same
  // real records it always did. Rendered once, in the header.
  overallStatusLabel?: string;
  // Unresolved applicability / commercial-use restrictions that must stay
  // visible rather than living inside a secondary view.
  restrictions?: string[];
  // Content for the two secondary views. Everything the old three opening
  // columns showed moves into these -- nothing is deleted.
  drawingInformationContent?: ReactNode;
  legacyToolsContent?: ReactNode;
  // Attention entries the shell already derives from records this panel has no
  // access to (sheet identity fields, symbol occurrences, BOQ requirement
  // conflicts / stale evidence). Each carries its own existing action.
  externalAttention?: Array<{
    id: string;
    kind: "decision" | "missing" | "pending";
    title: string;
    why: string;
    actionLabel?: string;
    onAction?: () => void;
  }>;
  // Symbol Review "Show on drawing": an external locate request for one
  // overlay item (id as built by buildDrawingOverlayItems, e.g.
  // `occurrence:<occurrenceId>`). A fresh nonce per activation guarantees
  // repeated requests for the same item re-fire; view-only (selection +
  // scroll + family enable), never a review mutation.
  focusedOverlayItem?: { itemId: string; nonce: number } | null;
}) {
  const {
    documentId,
    pages,
    assets,
    occurrences,
    regions,
    generalExtractionReviewOverrides,
    classifications,
    legendEntries,
    drawingNumber,
    sheetName,
    revision,
    aiVisualFindings,
    persistedCrossSheetResolutions,
    onVisualAnalysisComplete,
    onClose,
    overallStatusLabel,
    restrictions,
    drawingInformationContent,
    legacyToolsContent,
    externalAttention,
    focusedOverlayItem,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocumentRef = useRef<any>(null);
  const loadedDocumentIdRef = useRef<string | null>(null);
  // PDF.js throws "Cannot use the same canvas during multiple render()
  // operations" if a second render() starts on the same <canvas> before the
  // first's RenderTask finishes -- a real failure mode here, since page/
  // zoom changes (e.g. clicking + twice quickly) re-trigger this effect
  // faster than a render completes. Tracking the in-flight task lets a new
  // effect run cancel it first instead of racing it.
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<unknown> } | null>(null);

  // Shape widened (read-only) to the fields the existing GET
  // .../drawing-extraction response already returns for these saved runs --
  // the candidate drawing number recorded on the run's own input manifest, the
  // run-level reference/applicability state, and each pair's stored source
  // provenance (document, page, bounding box, sha256). Nothing new is fetched;
  // these were simply not being read before.
  type CandidateEvidence = { documentId?: string; documentVersionId?: string; pageNumber?: number; boundingBox?: Record<string, number>; sha256?: string; objectKey?: string; rotation?: number; renderScale?: number };
  type CandidateComparisonPair = { id: string; literalDescription: string; modelAssessment: string; modelFinishReason?: string | null; reviewStatus?: string; reviewedBy?: string | null; evaluationValidity?: string; applicability?: string; assistantVisualInspection?: { outcome: string; matchBasis: string; ambiguity: string }; wlcImageIndex: number; legendImageIndex: number; comparisonImageIndex?: number; legendEvidence?: CandidateEvidence; wlcEvidence?: CandidateEvidence };
  type CandidateComparisonRun = {
    id: string;
    status: string;
    created_at?: string;
    model_info?: string;
    page_number?: number;
    input_manifest?: { candidateDocumentId?: string; candidateDrawingNumber?: string; applicability?: string; approvedForTakeoff?: boolean; approvedForPricing?: boolean };
    result?: { applicability: string; historyWarning?: string; evaluationValidity?: string; referenceStatus?: string; revisionCompatibility?: string; reviewStatus?: string; comparisons: CandidateComparisonPair[] };
  };
  const [candidateComparisons, setCandidateComparisons] = useState<CandidateComparisonRun[]>([]);
  const refetchCandidateComparisons = () => {
    let active = true;
    fetch(`/api/documents/${encodeURIComponent(documentId)}/drawing-extraction`)
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active) setCandidateComparisons(data?.candidateComparisons || []); })
      .catch(() => { if (active) setCandidateComparisons([]); });
    return () => { active = false; };
  };
  useEffect(() => refetchCandidateComparisons(), [documentId]);
  const [pageNumber, setPageNumber] = useState<number>(pages[0]?.page_number || 1);
  // Fit-to-page on open. The drawing is the primary surface, so it must arrive
  // sized to the space it actually has, not at a fixed fraction that leaves a
  // sheet-size drawing stranded in blank space.
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest>({ mode: "fit-page", value: 1 });
  // The scale the canvas was ACTUALLY rendered at. Overlay geometry is mapped
  // with this exact value, so the boxes can never drift from the bitmap.
  const [renderedScale, setRenderedScale] = useState(1);
  // "Default to a clean drawing": no family overlays are drawn until the
  // engineer turns one on in the compact overlay control. The selected
  // finding's own evidence is always drawn regardless (see visibleItemsWithBox).
  const [activeSourceTypes, setActiveSourceTypes] = useState<Set<string>>(() => new Set<string>());
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [renderError, setRenderError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  // Measured size of the scrollable viewer area, the input to both fit modes.
  const viewerAreaRef = useRef<HTMLDivElement | null>(null);
  const [viewerArea, setViewerArea] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = viewerAreaRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setViewerArea((current) =>
        current && Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1
          ? current
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const zoom = renderedScale;

  useEffect(() => {
    if (pages.length && !pages.some((page) => page.page_number === pageNumber)) {
      setPageNumber(pages[0].page_number);
    }
  }, [pages, pageNumber]);

  useEffect(() => {
    setSelectedItemId(null);
  }, [pageNumber]);

  const currentPage = pages.find((page) => page.page_number === pageNumber) || null;

  // General Drawing Extraction Engine v0 -- reads the SAME Drawing Intake
  // text assets already passed in above; produces non-authoritative
  // EquipmentScheduleItem/CalloutReference/EquipmentCandidate/
  // PanelCandidate/RegionCandidate proposals (see
  // drawing-general-extraction-engine.mjs). Recomputed on every render from
  // already-fetched data -- this is a generated read-model, not a new
  // persisted table; nothing here writes anything.
  const generalExtractionProposals = useMemo(
    () => buildGeneralDrawingExtractionProposals({ pages, assets }),
    [pages, assets],
  );
  // Drawing-type-specific intelligence (Legend/Notes, Riser/Schematic,
  // Layout, Cause & Effect, Detail -- product integration pass): computed
  // client-side, same generated-read-model convention as General Drawing
  // Extraction above. documentRegistry is intentionally empty here (this
  // component only has ITS OWN document's context, not the whole
  // project's) -- a cross-sheet reference therefore renders "Unresolved"
  // client-side even when the persisted row (synced server-side, which
  // DOES have the full project document registry) has already resolved
  // it; a review action or page reload picks up the resolved, persisted
  // value via generalExtractionReviewOverrides / the sync path.
  const drawingIntelligenceResult = useMemo(
    () =>
      buildDrawingIntelligenceProposals({
        sourceDocument: { id: documentId, drawingNumber: drawingNumber ?? undefined, sheetName: sheetName ?? undefined },
        revision,
        pageNumber: pages[0]?.page_number ?? null,
        assets,
        legendEntries: legendEntries || [],
        classifications: classifications || [],
        documentRegistry: [],
      }),
    [documentId, drawingNumber, sheetName, revision, pages, assets, legendEntries, classifications],
  );
  // Maps a persisted AI visual-understanding proposal row (already-hydrated
  // by worker/drawing-extraction-api.mjs -- see hydrateProposal) into the
  // SAME OverlayItem shape every other source uses. The AI mapper
  // (app/domain/drawing-visual-understanding-contract.mjs) always writes
  // evidence.category and always leaves boundingBox null -- this is purely
  // a display-shape adapter, no interpretation happens here.
  const aiItems = useMemo<OverlayItem[]>(() => {
    return (aiVisualFindings || []).filter(row => !row.supersededAt).map((row): AiVisualOverlayItem => {
      const override = generalExtractionReviewOverrides?.[row.proposalKey];
      return {
        id: row.proposalKey,
        pageNumber: row.pageNumber,
        sourceType: AI_SOURCE_TYPE_BY_CATEGORY[row.evidence?.category as string] || "AiFinding",
        semanticType: row.proposalType,
        proposalType: row.proposalType,
        label: row.rawLabel || "",
        confidence: row.confidence,
        authorityRole: row.authorityRole,
        governedStatus: row.governedStatus,
        reviewStatus: override ? override.reviewStatus : row.reviewStatus,
        // The real persisted review metadata, carried through so the details
        // view can report who decided and why instead of guessing a reason.
        reviewedBy: override ? override.reviewedBy ?? null : row.reviewedBy ?? null,
        reviewedAt: override ? override.reviewedAt ?? null : row.reviewedAt ?? null,
        reviewReason: override ? override.reviewReason ?? null : row.reviewReason ?? null,
        hardReviewReasons: row.hardReviewReasons || [],
        boundingBox: row.boundingBox,
        extractionMethod: row.extractionMethod,
        drawingType: row.evidence?.drawingType ?? null,
        sourceDrawingNumber: row.evidence?.sourceDrawingNumber ?? null,
        sourceSheet: row.evidence?.sourceSheet ?? null,
        sourceRevision: row.evidence?.sourceRevision ?? null,
        evidence: row.evidence || {},
        sourceEntity: { kind: "AiVisualFinding", id: row.proposalKey, sourceReferences: row.sourceReferences || [], documentId: row.documentId ?? documentId },
      };
    });
  }, [aiVisualFindings, generalExtractionReviewOverrides, documentId]);
  const overlayItems = useMemo<OverlayItem[]>(() => {
    const generalExtractionItems: OverlayItem[] = buildGeneralExtractionOverlayItems(generalExtractionProposals).map((item) => {
      const override = generalExtractionReviewOverrides?.[item.id];
      return override ? { ...item, reviewStatus: override.reviewStatus } : item;
    });
    const intelligenceItems: OverlayItem[] = buildDrawingIntelligenceOverlayItems(drawingIntelligenceResult, {
      sourceDocument: { id: documentId, drawingNumber: drawingNumber ?? undefined, sheetName: sheetName ?? undefined },
      revision,
    }).map((item): DrawingIntelligenceOverlayItem => {
      // Cross-Sheet Reference only: this item's evidence.resolvedTargetDocumentId
      // /applicabilitySource/revisionCompatibility/status were just computed
      // above with an intentionally EMPTY document registry (this panel has
      // no project-wide context) -- the real, server-computed outcome (the
      // SAME pure resolver, run with the actual registry) is substituted in
      // when a current, non-superseded persisted record for this exact
      // reference exists. Every other evidence field (referencedDrawingNumber,
      // applicableSystem, noteText, ...) is registry-independent and untouched.
      const resolution = item.sourceType === "CrossSheetRef" ? persistedCrossSheetResolutions?.[item.id] : undefined;
      const withResolution = resolution
        ? {
            ...item,
            evidence: {
              ...item.evidence,
              resolvedTargetDocumentId: resolution.resolvedTargetDocumentId,
              applicabilitySource: resolution.applicabilitySource ?? item.evidence?.applicabilitySource,
              revisionCompatibility: resolution.revisionCompatibility ?? item.evidence?.revisionCompatibility,
              status: resolution.status ?? item.evidence?.status,
            },
          }
        : item;
      const override = generalExtractionReviewOverrides?.[item.id];
      return override ? { ...withResolution, reviewStatus: override.reviewStatus } : withResolution;
    });
    const baseItems: OverlayItem[] = buildDrawingOverlayItems({ pages, assets, occurrences, regions });
    return [...baseItems, ...generalExtractionItems, ...intelligenceItems, ...aiItems];
  }, [pages, assets, occurrences, regions, generalExtractionProposals, drawingIntelligenceResult, generalExtractionReviewOverrides, persistedCrossSheetResolutions, documentId, drawingNumber, sheetName, revision, aiItems]);
  const pageItems = useMemo(
    () => filterDrawingOverlayItems(overlayItems, { pageNumber }),
    [overlayItems, pageNumber],
  );
  // The readable "what this drawing explains / main findings / needs
  // clarification" summary (Part 3) -- built ONLY from pageItems (the same
  // validated items the filter toggles and findings list below already
  // show, review overrides already applied), never a new model call and
  // never a fact not already backed by one of those items.
  const understandingSummary = useMemo(
    () =>
      buildDrawingUnderstandingSummary({
        sourceDocument: { id: documentId, drawingNumber: drawingNumber ?? undefined, sheetName: sheetName ?? undefined, revision: revision ?? undefined },
        drawingType: drawingIntelligenceResult?.drawingType ?? null,
        items: pageItems,
        historicalCount: (aiVisualFindings || []).filter(row => row.supersededAt).length,
      }),
    [documentId, drawingNumber, sheetName, revision, drawingIntelligenceResult, pageItems, aiVisualFindings],
  );
  // Some upstream extraction items carry coordinates with no overlap with
  // the page at all (a real, observed Drawing Intake data-quality issue,
  // not something this component can fix) -- mapCanonicalBoxToViewport
  // returns null for those rather than a misleading clamped corner box.
  // Computing that once here, for every item on the page, means the
  // toolbar's per-filter counts and what's actually drawn on canvas always
  // agree -- neither one silently claims more items are visible than are.
  const pageItemsWithBox = useMemo(() => {
    if (!currentPage) return [];
    return pageItems
      .map((item) => ({
        item,
        box: mapCanonicalBoxToViewport(
          item.boundingBox,
          { pageWidth: currentPage.width, pageHeight: currentPage.height },
          { scale: zoom, rotation: currentPage.rotation || 0 },
        ),
      }))
      .filter((entry): entry is { item: (typeof pageItems)[number]; box: NonNullable<typeof entry.box> } => Boolean(entry.box));
  }, [pageItems, currentPage, zoom]);
  // The selected finding's own evidence is always drawn, even with every
  // family overlay switched off -- that is the whole point of selecting it.
  const visibleItemsWithBox = useMemo(
    () =>
      pageItemsWithBox.filter(
        (entry) => activeSourceTypes.has(entry.item.sourceType) || entry.item.id === selectedItemId,
      ),
    [pageItemsWithBox, activeSourceTypes, selectedItemId],
  );
  // Items whose canonical bounding box has no overlap with the page at all
  // (the same known Drawing Intake data-quality issue noted above -- real
  // on some sheets, e.g. callout numbers extracted from an unresolved
  // nested transform) are correctly excluded from pageItemsWithBox and so
  // cannot be drawn on the canvas. They are still real, correctly-extracted
  // evidence -- listing them separately (inspectable, never positioned) is
  // the minimal UI addition needed so a callout like this is not simply
  // invisible in Visual Review.
  const unplacedVisibleItems = useMemo(() => {
    const placedIds = new Set(pageItemsWithBox.map((entry) => entry.item.id));
    return pageItems.filter((item) => !placedIds.has(item.id) && activeSourceTypes.has(item.sourceType));
  }, [pageItems, pageItemsWithBox, activeSourceTypes]);
  const selectedItem = pageItems.find((item) => item.id === selectedItemId) || null;
  // A finding whose OWN record carries no page coordinates (every AI visual
  // proposal, by contract) is never given an invented location. But the source
  // text it was derived from IS stored with real coordinates, on this same
  // page, in the same canonical frame -- so that stored text is what gets
  // highlighted, labelled as the source passage rather than as the finding.
  const selectedSourceTextBoxes = useMemo(() => {
    if (!selectedItem || !currentPage) return [];
    if (pageItemsWithBox.some((entry) => entry.item.id === selectedItem.id)) return [];
    const references = (selectedItem.evidence as Record<string, any>)?.sourceTextReferences;
    if (!Array.isArray(references)) return [];
    return references
      .map((reference: Record<string, any>, index: number) => ({
        key: `${selectedItem.id}:source:${index}`,
        text: String(reference?.text ?? ""),
        pageNumber: reference?.pageNumber ?? pageNumber,
        box: reference?.boundingBox
          ? mapCanonicalBoxToViewport(
              reference.boundingBox,
              {
                pageWidth: reference.boundingBox.pageWidth ?? currentPage.width,
                pageHeight: reference.boundingBox.pageHeight ?? currentPage.height,
              },
              { scale: renderedScale, rotation: currentPage.rotation || 0 },
            )
          : null,
      }))
      .filter((entry) => entry.box && entry.pageNumber === pageNumber) as Array<{
      key: string;
      text: string;
      pageNumber: number;
      box: { left: number; top: number; width: number; height: number };
    }>;
  }, [selectedItem, pageItemsWithBox, currentPage, pageNumber, renderedScale]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!currentPage || !canvasRef.current) return;
      // A fit mode has no meaning until the viewer area has been measured;
      // rendering first would show the page at a throwaway scale and then jump.
      if (zoomRequest.mode !== "manual" && !viewerArea) return;
      // Cancel any still-running render on this canvas before touching it
      // again -- awaiting its (rejected) promise first guarantees PDF.js
      // has actually released the canvas before the next render() call.
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        await renderTaskRef.current.promise.catch(() => {});
        renderTaskRef.current = null;
      }
      if (cancelled) return;
      setRenderError("");
      setRendering(true);
      try {
        if (loadedDocumentIdRef.current !== documentId || !pdfDocumentRef.current) {
          const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
          // The browser build (unlike the legacy/Node build the backend
          // engines use, which auto-falls-back to running on the main
          // thread in a Worker-less environment) requires a real worker
          // script URL -- Vite resolves this bare specifier through its
          // own asset pipeline via the new URL(..., import.meta.url)
          // pattern, same as it would for a relative worker import.
          if (!pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
              "pdfjs-dist/build/pdf.worker.mjs",
              import.meta.url,
            ).toString();
          }
          // Bounded load. Observed directly: when the preview endpoint cannot
          // return the source bytes (a 500), PDF.js keeps retrying and its
          // promise never settles -- which used to leave "Rendering page…" up
          // forever. That was tolerable while the viewer lived under a
          // collapsed Advanced section; it is not, now that the drawing is the
          // primary surface. 45s is far beyond any observed successful load of
          // these sheets, so a genuinely slow-but-working load is never killed.
          const loadingTask = pdfjs.getDocument({
            url: `/api/documents/${encodeURIComponent(documentId)}/preview`,
            isEvalSupported: false,
          });
          let loadTimeout: ReturnType<typeof setTimeout> | undefined;
          const loaded = await Promise.race([
            loadingTask.promise,
            new Promise<never>((_, reject) => {
              loadTimeout = setTimeout(() => {
                try {
                  void loadingTask.destroy();
                } catch {
                  // best-effort teardown; the rejection below is what matters
                }
                reject(
                  new Error(
                    "The source PDF for this drawing could not be loaded from its preview endpoint. Nothing is rendered rather than showing a partial or stale page — the findings and evidence listed beside it are unaffected.",
                  ),
                );
              }, DOCUMENT_LOAD_TIMEOUT_MS);
            }),
          ]).finally(() => clearTimeout(loadTimeout));
          if (cancelled) return;
          pdfDocumentRef.current = loaded;
          loadedDocumentIdRef.current = documentId;
        }
        const pdf = pdfDocumentRef.current;
        const page = await pdf.getPage(pageNumber);
        // Render at the page's real intrinsic /Rotate (persisted by Drawing
        // Intake -- see app/domain/drawing-intake-engine.mjs), matching what
        // any standard PDF viewer displays. Extraction engines' bounding
        // boxes stay in the unrotated MediaBox frame regardless (PDF.js
        // item.transform / page.view are unaffected by rotation), so
        // mapCanonicalBoxToViewport is given this SAME rotation value above
        // to convert them into this rotated canvas's pixel space -- the two
        // must never diverge, since that is exactly what silently desyncs
        // the canvas from the overlay math.
        const rotation = currentPage.rotation || 0;
        // Fit is computed from THIS page's real PDF.js viewport at scale 1 and
        // the measured viewer area -- no guessed content bounds, and correct
        // for rotated sheets because getViewport already applies the rotation.
        const baseViewport = page.getViewport({ scale: 1, rotation });
        const availableWidth = Math.max(80, (viewerArea?.width ?? 0) - FIT_PADDING);
        const availableHeight = Math.max(80, (viewerArea?.height ?? 0) - FIT_PADDING);
        const scale = clampScale(
          zoomRequest.mode === "manual"
            ? zoomRequest.value
            : zoomRequest.mode === "fit-width"
              ? availableWidth / baseViewport.width
              : Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height),
        );
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (!context) return;
        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;
        if (!cancelled) {
          // Overlay math reads renderedScale, so it is published only after the
          // bitmap it describes actually exists. It is intentionally NOT an
          // input to this effect -- publishing it cannot re-trigger a render.
          setRenderedScale(scale);
          setCanvasSize({ width: viewport.width, height: viewport.height });
        }
      } catch (error) {
        renderTaskRef.current = null;
        // A cancelled RenderTask rejects by design (name "RenderingCancelledException")
        // -- that is this component superseding its own stale render, not a
        // real failure, so it must never surface as a user-facing error.
        const isCancellation = error instanceof Object && (error as any).name === "RenderingCancelledException";
        if (!cancelled && !isCancellation)
          setRenderError(error instanceof Error ? error.message : "Drawing page could not be rendered.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    void render();
    return () => {
      cancelled = true;
      // Cancel synchronously, in the commit phase, rather than waiting for
      // the NEXT effect run's render() to get around to it -- closes the
      // window where two render() calls could both slip past their guard
      // checks and race on the same canvas.
      renderTaskRef.current?.cancel();
    };
  }, [documentId, pageNumber, zoomRequest, viewerArea, currentPage]);

  // Compact zoom controls operate on whatever scale is currently rendered, so
  // stepping in or out of a fitted view is continuous rather than snapping to
  // a fixed ladder.
  const stepZoom = useCallback(
    (direction: 1 | -1) =>
      setZoomRequest({ mode: "manual", value: clampScale(renderedScale * (direction === 1 ? SCALE_STEP : 1 / SCALE_STEP)) }),
    [renderedScale],
  );

  // Real visual analysis (Source-Backed Drawing Understanding pilot):
  // renders this SAME page independently at a resolution chosen for
  // legibility (not the user's current on-screen zoom, which defaults low
  // for large sheets): one overview plus complementary equipment/location,
  // circuit/status and notes/reference crops, then additional dense details.
  // All use the same rotation-correct renderer and preserve input provenance.
  const [visualAnalysisStatus, setVisualAnalysisStatus] = useState<"Idle" | "Rendering" | "Analyzing" | "Error">("Idle");
  const [visualAnalysisError, setVisualAnalysisError] = useState("");
  const OVERVIEW_TARGET_LONG_EDGE = 1400;
  // Target long edge for a CROP once tightly bounded to its own content
  // cluster -- deliberately smaller than the old blind-quadrant target
  // (2800), since a tight crop needs far fewer pixels to make its content
  // fill the frame. Bounded per-region scale (MIN/MAX_CROP_SCALE) keeps a
  // very small or very large real cluster from producing a degenerate
  // (illegibly small or absurdly huge) render.
  const CROP_TARGET_LONG_EDGE = 1000;
  const MIN_CROP_SCALE = 0.4;
  const MAX_CROP_SCALE = 4;

  const renderPageToCanvas = async (page: any, scale: number, rotation: number) => {
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Offscreen canvas context unavailable.");
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
  };

  // Renders ONLY a small region, not the whole page -- critical once a
  // region's own calibrated scale can run up to MAX_CROP_SCALE (4x native):
  // a full-page canvas at that scale for a large page is tens of millions
  // of pixels and was observed to make rendering unusably slow. A canvas
  // sized to just the crop's own output dimensions, painted via a
  // translated PDF.js viewport (page.render's `transform` shifts what
  // paints into view without changing the canvas's own pixel buffer size,
  // so content outside the small canvas is naturally clipped, never
  // allocated), stays fast regardless of scale.
  const renderRegionToCanvas = async (page: any, canonicalRect: { x: number; y: number; width: number; height: number }, scale: number, rotation: number, pageForCrops: { pageWidth: number; pageHeight: number }) => {
    const viewport = page.getViewport({ scale, rotation });
    const box = mapCanonicalBoxToViewport(canonicalRect, pageForCrops, { scale, rotation });
    if (!box) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.width));
    canvas.height = Math.max(1, Math.round(box.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Offscreen canvas context unavailable.");
    await page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -box.left, -box.top] }).promise;
    return canvas;
  };

  const analyzeVisually = async () => {
    if (!currentPage) return;
    setVisualAnalysisError("");
    setVisualAnalysisStatus("Rendering");
    try {
      const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      }
      const pdf =
        pdfDocumentRef.current && loadedDocumentIdRef.current === documentId
          ? pdfDocumentRef.current
          : (pdfDocumentRef.current = await pdfjs.getDocument({ url: `/api/documents/${encodeURIComponent(documentId)}/preview`, isEvalSupported: false }).promise);
      loadedDocumentIdRef.current = documentId;
      const page = await pdf.getPage(pageNumber);
      const rotation = currentPage.rotation || 0;
      const nativeViewport = page.getViewport({ scale: 1, rotation });
      const nativeLongEdge = Math.max(nativeViewport.width, nativeViewport.height);

      const images: Array<{ base64: string; kind: "overview" | "crop"; cropRect: Record<string, number | string> | null }> = [];

      const overviewScale = OVERVIEW_TARGET_LONG_EDGE / nativeLongEdge;
      const overviewCanvas = await renderPageToCanvas(page, overviewScale, rotation);
      images.push({ base64: overviewCanvas.toDataURL("image/png").split(",")[1], kind: "overview", cropRect: null });

      const pageForCrops = { pageWidth: currentPage.width, pageHeight: currentPage.height };
      const regions = computeComplementaryCropRegions({ assets: assets.filter(asset => asset.page_id === currentPage.id), pageWidth: currentPage.width, pageHeight: currentPage.height, maxRegions: 7 });
      for (const region of regions) {
        const regionLongEdge = Math.max(region.rect.width, region.rect.height);
        const regionScale = Math.min(MAX_CROP_SCALE, Math.max(MIN_CROP_SCALE, CROP_TARGET_LONG_EDGE / regionLongEdge));
        const cropCanvas = await renderRegionToCanvas(page, region.rect, regionScale, rotation, pageForCrops);
        if (!cropCanvas) continue;
        images.push({
          base64: cropCanvas.toDataURL("image/png").split(",")[1],
          kind: "crop",
          cropRect: { ...region.rect, purpose: region.purpose, coordinateSpace: "canonical-pdf", itemCount: region.itemCount, viewportScale: regionScale, viewportRotation: rotation },
        });
      }

      setVisualAnalysisStatus("Analyzing");
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/drawing-extraction/visual-analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageNumber, images }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Visual analysis failed.");
      setVisualAnalysisStatus("Idle");
      onVisualAnalysisComplete?.();
    } catch (error) {
      setVisualAnalysisStatus("Error");
      setVisualAnalysisError(error instanceof Error ? error.message : "Visual analysis failed.");
    }
  };

  // Limited in-app candidate-legend comparison pilot. Renders the 6 frozen
  // pilot cases' WLC and candidate-legend crops through this app's own
  // PDF.js/rotation pipeline (the same renderRegionToCanvas used above --
  // no external image preparation), builds one fit-to-content composite
  // per case, and submits them through the existing candidate-comparison
  // endpoint/contract. Only offered on the WLC document this pilot targets.
  const [pilotStatus, setPilotStatus] = useState<"Idle" | "Rendering" | "ReadyForReview" | "Submitting" | "Error" | "Done">("Idle");
  const [pilotError, setPilotError] = useState("");
  const [pilotDiagnostics, setPilotDiagnostics] = useState<string[]>([]);
  const [pilotPreview, setPilotPreview] = useState<Array<{ caseId: string; note: string; category: string; wlcDataUrl: string; legendDataUrl: string; compositeDataUrl: string; wlcElapsedMs: number; legendElapsedMs: number }>>([]);
  const pilotPayloadRef = useRef<{ candidateDocId: string; candidateVersionId: string; wlcVersionId: string; entries: Array<Record<string, any>>; comparisons: Array<Record<string, any>>; images: Array<Record<string, any>> } | null>(null);
  const [pilotSummary, setPilotSummary] = useState<Array<{ caseId: string; note: string; category: string; modelAssessment: string; modelFinishReason: string | null; priorExternalObservation: string; wlcImageSha256: string; legendImageSha256: string; comparisonImageSha256: string }>>([]);

  // Bounded render with real cancellation: races PDF.js's RenderTask
  // against a hard timeout and calls RenderTask.cancel() (the documented
  // PDF.js API for aborting an in-flight render) if it fires, so a stalled
  // render can never leave the UI indefinitely busy. Returns elapsed time
  // on success as real diagnostic evidence, not an assumption.
  // Calibrated from measured evidence, not a guess: repeated measurements
  // of the SAME crop (same page, rect, scale) ranged from 3500ms to
  // 46768ms across separate runs in this dev environment, with one full
  // 60000ms timeout observed -- a >10x spread that points to environmental/
  // resource variability (this machine, this Chrome process, this dev
  // server), not a fixed per-region content cost. 120s gives real headroom
  // over every measured case so a genuinely slow-but-completing render
  // isn't killed prematurely, while still bounding the UI so a true hang
  // cannot block it indefinitely.
  const PILOT_RENDER_TIMEOUT_MS = 120000;
  const renderRegionToCanvasBounded = async (
    page: any,
    canonicalRect: { x: number; y: number; width: number; height: number },
    scale: number,
    rotation: number,
    pageForCrops: { pageWidth: number; pageHeight: number },
    label: string,
  ) => {
    const viewport = page.getViewport({ scale, rotation });
    const box = mapCanonicalBoxToViewport(canonicalRect, pageForCrops, { scale, rotation });
    if (!box) throw new Error(`${label}: mapped viewport box was null (region outside page bounds at rotation=${rotation}).`);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.width));
    canvas.height = Math.max(1, Math.round(box.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Offscreen canvas context unavailable.");
    const renderTask = page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -box.left, -box.top] });
    const startedAt = Date.now();
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        // Reject BEFORE cancelling: renderTask.cancel() synchronously queues
        // its own promise-rejection microtask, and if that were queued
        // first, Promise.race below would settle on PDF.js's own bare
        // "Rendering cancelled" message instead of this one (observed
        // directly while diagnosing this). Rejecting first guarantees this
        // descriptive message wins the race deterministically.
        reject(new Error(`${label}: render timed out after ${PILOT_RENDER_TIMEOUT_MS}ms (rotation=${rotation}, scale=${scale.toFixed(2)}, canonicalRect=${JSON.stringify(canonicalRect)}, output=${canvas.width}x${canvas.height}). RenderTask.cancel() was called.`));
        try {
          renderTask.cancel();
        } catch {
          // best-effort cancellation; the timeout error above is what matters
        }
      }, PILOT_RENDER_TIMEOUT_MS);
    });
    try {
      await Promise.race([renderTask.promise, timeoutPromise]);
    } catch (error) {
      if (timedOut) throw error;
      throw new Error(`${label}: render failed (rotation=${rotation}, scale=${scale.toFixed(2)}): ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeoutHandle!);
    }
    return { canvas, elapsedMs: Date.now() - startedAt };
  };

  // Phase 1: render the 6 frozen cases' crops through the real PDF.js
  // pipeline and stop -- no model call yet. Results are held in
  // pilotPayloadRef and shown as previews so they can be visually verified
  // (correct occurrence, correct legend row, complete symbol/qualifiers, no
  // clipping) before submitCandidateComparisonPilot is ever invoked.
  const renderCandidateComparisonPilotCrops = async () => {
    if (documentId !== CANDIDATE_COMPARISON_PILOT_DOCUMENT_IDS.wlc) return;
    setPilotError("");
    setPilotPreview([]);
    setPilotSummary([]);
    setPilotDiagnostics([]);
    pilotPayloadRef.current = null;
    setPilotStatus("Rendering");
    const diagnostics: string[] = [];
    try {
      const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      }
      // Deliberately NOT reusing pdfDocumentRef/loadedDocumentIdRef here.
      // Root cause found: those are shared with this panel's own on-screen
      // preview render effect (the useEffect that draws canvasRef), which
      // keeps re-rendering the SAME PDFPageProxy for the currently-viewed
      // page/zoom while this modal stays open. A concurrent page.render()
      // call from this pilot on that SAME shared page object was observed
      // to throw a genuine PDF.js RenderingCancelledException ("Rendering
      // cancelled, page 1") -- one render cancelling the other, not a
      // content-complexity stall. Loading a fully separate PDFDocumentProxy
      // here (a second, independent parse of the same bytes) gives the
      // pilot its own PDFPageProxy with no shared render lock.
      const wlcPdf = await pdfjs.getDocument({ url: `/api/documents/${encodeURIComponent(documentId)}/preview`, isEvalSupported: false }).promise;
      const wlcPage = await wlcPdf.getPage(1);
      const wlcPageDims = { pageWidth: 2384, pageHeight: 3370 };
      const wlcRotation = 90;

      const candidateDocId = CANDIDATE_COMPARISON_PILOT_DOCUMENT_IDS.candidate;
      const candidatePdf = await pdfjs.getDocument({ url: `/api/documents/${encodeURIComponent(candidateDocId)}/preview`, isEvalSupported: false }).promise;
      const candidatePage = await candidatePdf.getPage(1);
      // Reconciled directly against the raw PDF bytes (not assumed): this
      // candidate PDF's own embedded /Rotate is 90, native /MediaBox is
      // [0 0 2384 3370]. The persisted drawing_pages row for this document
      // (rotation:0, width:3370, height:2384) does not match the PDF and is
      // not used here. pageForCrops is always the NATIVE (pre-rotation)
      // dimensions paired with the real rotation, exactly like WLC above --
      // this also matches the pageWidth/pageHeight already embedded in this
      // candidate's own persisted LegendDefinition evidence. Rendered
      // directly at rotation:90 (no post-render canvas-rotation workaround)
      // using the bounded/cancellable renderer above.
      const candidatePageDims = { pageWidth: 2384, pageHeight: 3370 };
      const candidateRotation = 90;

      const projectDocuments = await fetch(`/api/projects/${encodeURIComponent(CANDIDATE_COMPARISON_PILOT_DOCUMENT_IDS.projectId)}/documents?pageSize=100`).then(r => r.json());
      const wlcRow = (projectDocuments.documents || []).find((d: any) => d.id === documentId);
      const candidateRow = (projectDocuments.documents || []).find((d: any) => d.id === candidateDocId);
      if (!wlcRow?.version_id || !candidateRow?.version_id) throw new Error("Could not resolve current document versions for the pilot's two source documents.");

      const canvasToBase64 = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png").split(",")[1];

      const CROP_TARGET_LONG_EDGE_PILOT = 320;
      const scaleFor = (rect: { width: number; height: number }) => Math.min(20, Math.max(2, CROP_TARGET_LONG_EDGE_PILOT / Math.max(rect.width, rect.height)));

      const images: Array<Record<string, any>> = [];
      const imageIndexByKey = new Map<string, { index: number; canvas: HTMLCanvasElement; elapsedMs: number }>();
      const addSourceImage = async (key: string, page: any, rect: { x: number; y: number; width: number; height: number }, rotation: number, pageForCrops: { pageWidth: number; pageHeight: number }, docRow: { documentId: string; documentVersionId: string; pageNumber: number }, label: string) => {
        const cached = imageIndexByKey.get(key);
        if (cached) return cached;
        const scale = scaleFor(rect);
        const { canvas, elapsedMs } = await renderRegionToCanvasBounded(page, rect, scale, rotation, pageForCrops, label);
        diagnostics.push(`${label}: rendered in ${elapsedMs}ms (rotation=${rotation}, scale=${scale.toFixed(2)}, output=${canvas.width}x${canvas.height}).`);
        const base64 = canvasToBase64(canvas);
        const index = images.length;
        images.push({ base64, kind: "source", documentId: docRow.documentId, documentVersionId: docRow.documentVersionId, pageNumber: docRow.pageNumber, boundingBox: rect, renderScale: scale, rotation, canvasWidth: canvas.width, canvasHeight: canvas.height });
        const entry = { index, canvas, elapsedMs };
        imageIndexByKey.set(key, entry);
        return entry;
      };

      const buildComposite = (leftCanvas: HTMLCanvasElement, rightCanvas: HTMLCanvasElement) => {
        const margin = 16;
        const labelHeight = 22;
        const gap = 24;
        const width = margin * 2 + leftCanvas.width + gap + rightCanvas.width;
        const height = margin * 2 + labelHeight + Math.max(leftCanvas.height, rightCanvas.height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#000000";
        ctx.font = "16px sans-serif";
        ctx.fillText("LEFT", margin, margin + 16);
        ctx.fillText("RIGHT", margin + leftCanvas.width + gap, margin + 16);
        ctx.drawImage(leftCanvas, margin, margin + labelHeight);
        ctx.drawImage(rightCanvas, margin + leftCanvas.width + gap, margin + labelHeight);
        return canvas;
      };

      const entries: Array<Record<string, any>> = [];
      const comparisons: Array<Record<string, any>> = [];
      const preview: Array<{ caseId: string; note: string; category: string; wlcDataUrl: string; legendDataUrl: string; compositeDataUrl: string; wlcElapsedMs: number; legendElapsedMs: number }> = [];

      for (const pilotCase of CANDIDATE_COMPARISON_PILOT_CASES) {
        const legendRect = pilotCase.legendEntry.boundingBox;
        const wlcKey = `wlc:${JSON.stringify(pilotCase.wlcRect)}`;
        const legendKey = `legend:${pilotCase.legendEntry.sequence}`;

        const wlcSource = await addSourceImage(wlcKey, wlcPage, pilotCase.wlcRect, wlcRotation, wlcPageDims, { documentId, documentVersionId: wlcRow.version_id, pageNumber: 1 }, `${pilotCase.caseId} WLC crop`);
        const legendSource = await addSourceImage(legendKey, candidatePage, legendRect, candidateRotation, candidatePageDims, { documentId: candidateDocId, documentVersionId: candidateRow.version_id, pageNumber: 1 }, `${pilotCase.caseId} legend crop`);

        const compositeCanvas = buildComposite(wlcSource.canvas, legendSource.canvas);
        const compositeBase64 = canvasToBase64(compositeCanvas);
        const comparisonImageIndex = images.length;
        images.push({ base64: compositeBase64, kind: "comparison", documentId, documentVersionId: wlcRow.version_id, pageNumber: 1, componentImageIndices: [wlcSource.index, legendSource.index] });

        // Every pilot case uses a distinct legend sequence (1,2,3,4,18,19),
        // so entries never collide -- only the WLC-side image can repeat
        // (handled above via imageIndexByKey), never the legend entry.
        entries.push({ ...pilotCase.legendEntry, imageIndex: legendSource.index });
        comparisons.push({ id: pilotCase.caseId, legendEntryId: pilotCase.legendEntry.id, wlcImageIndex: wlcSource.index, legendImageIndex: legendSource.index, comparisonImageIndex });

        preview.push({
          caseId: pilotCase.caseId,
          note: pilotCase.note,
          category: pilotCase.category,
          wlcDataUrl: wlcSource.canvas.toDataURL("image/png"),
          legendDataUrl: legendSource.canvas.toDataURL("image/png"),
          compositeDataUrl: compositeCanvas.toDataURL("image/png"),
          wlcElapsedMs: wlcSource.elapsedMs,
          legendElapsedMs: legendSource.elapsedMs,
        });
        setPilotDiagnostics([...diagnostics]);
      }

      pilotPayloadRef.current = { candidateDocId, candidateVersionId: candidateRow.version_id, wlcVersionId: wlcRow.version_id, entries, comparisons, images };
      setPilotPreview(preview);
      setPilotStatus("ReadyForReview");
    } catch (error) {
      setPilotDiagnostics([...diagnostics]);
      setPilotStatus("Error");
      console.error("[pilot-render-error]", error, error instanceof Error ? error.stack : undefined);
      setPilotError(error instanceof Error ? error.message : "Candidate comparison pilot render failed.");
    }
  };

  // Phase 2: submit the ALREADY-rendered (and visually verified) crops from
  // pilotPayloadRef. Never re-renders and never runs without a prior
  // successful render pass.
  const submitCandidateComparisonPilot = async () => {
    const payload = pilotPayloadRef.current;
    if (!payload) return;
    setPilotError("");
    setPilotStatus("Submitting");
    try {
      const sha256Hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))).map(b => b.toString(16).padStart(2, "0")).join("");
      const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));

      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/drawing-extraction/candidate-comparison`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidateDocumentId: payload.candidateDocId,
          candidateDocumentVersionId: payload.candidateVersionId,
          wlcDocumentVersionId: payload.wlcVersionId,
          pageNumber: 1,
          visuallyExtractedRevision: revision || "",
          entries: payload.entries,
          comparisons: payload.comparisons,
          images: payload.images,
        }),
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error?.message || body.error?.code || "Candidate comparison pilot submission failed.");

      const summary = [];
      for (const pair of body.comparisons || []) {
        const pilotCase = CANDIDATE_COMPARISON_PILOT_CASES.find(c => c.caseId === pair.id);
        const wlcBytes = base64ToBytes(payload.images[pair.wlcImageIndex].base64);
        const legendBytes = base64ToBytes(payload.images[pair.legendImageIndex].base64);
        const compositeBytes = base64ToBytes(payload.images[pair.comparisonImageIndex].base64);
        summary.push({
          caseId: pair.id,
          note: pilotCase?.note || "",
          category: pilotCase?.category || "",
          modelAssessment: pair.modelAssessment,
          modelFinishReason: pair.modelFinishReason ?? null,
          priorExternalObservation: pilotCase?.priorExternalObservation || "",
          wlcImageSha256: await sha256Hex(wlcBytes),
          legendImageSha256: await sha256Hex(legendBytes),
          comparisonImageSha256: await sha256Hex(compositeBytes),
        });
      }
      setPilotSummary(summary);
      setPilotStatus("Done");
      refetchCandidateComparisons();
    } catch (error) {
      setPilotStatus("Error");
      setPilotError(error instanceof Error ? error.message : "Candidate comparison pilot submission failed.");
    }
  };

  useEffect(
    () => () => {
      pdfDocumentRef.current = null;
      loadedDocumentIdRef.current = null;
    },
    [documentId],
  );

  // ---------------------------------------------------------------------
  // Drawing Workspace presentation
  //
  // The drawing is the primary surface: a ~2/3 viewer beside a ~1/3
  // findings/inspection sidebar, both visible on open. Everything that used to
  // sit above them (metadata columns, duplicated banners, finding card grids,
  // the comparison pilot) moved into the two secondary views reached from the
  // header -- moved, not deleted.
  //
  // Nothing here reads or writes any record this panel did not already read or
  // write. Review actions still call the exact same handlers, and opening the
  // workspace still triggers no model call.
  // ---------------------------------------------------------------------
  type SecondaryView = "information" | "history";
  const [secondaryView, setSecondaryView] = useState<SecondaryView | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"findings" | "attention">("findings");
  // `selectedItemId` drives the viewer highlight; `sidebarMode` drives whether
  // the sidebar shows the list or that item's details. Keeping them separate is
  // what lets "back to list" leave the drawing exactly where the engineer left
  // it -- same page, same zoom, same scroll, same highlight.
  const [sidebarMode, setSidebarMode] = useState<"list" | "detail">("list");
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  const toggleSourceType = (sourceType: string) => {
    setActiveSourceTypes((current) => {
      const next = new Set(current);
      if (next.has(sourceType)) next.delete(sourceType);
      else next.add(sourceType);
      return next;
    });
  };

  // Selecting a finding focuses its REAL evidence: the stored box for that
  // exact record, scrolled into view at the current zoom. An item with no
  // usable page position is never given an invented one -- the details view
  // says so instead (see renderItemDetails).
  const openFinding = (itemId: string) => {
    setSelectedItemId(itemId);
    setSidebarMode("detail");
    setSecondaryView(null);
  };
  useEffect(() => {
    if (!selectedItemId) return;
    const area = viewerAreaRef.current;
    const wrap = canvasWrapRef.current;
    // Only auto-scrolls to a box this app can stand behind (the item's own
    // governed boundingBox). The sourceTextReferences fallback is deliberately
    // excluded -- see the canvas overlay comment on why its geometry is not
    // trustworthy enough to navigate the viewer to.
    const box = pageItemsWithBox.find((candidate) => candidate.item.id === selectedItemId)?.box;
    if (!area || !wrap || !box) return;
    area.scrollTo({
      left: Math.max(0, wrap.offsetLeft + box.left + box.width / 2 - area.clientWidth / 2),
      top: Math.max(0, wrap.offsetTop + box.top + box.height / 2 - area.clientHeight / 2),
      behavior: "instant" as ScrollBehavior,
    });
  }, [selectedItemId, pageItemsWithBox]);

  // External locate ("Show on drawing" from Symbol Review): resolve the
  // requested overlay item across ALL pages, switch viewer page when needed,
  // select it (existing highlight + auto-scroll take over from there), and
  // enable its family so surrounding context stays visible. Consumed nonces
  // are never re-applied, so manual selection afterwards is never fought.
  // Unknown ids or items without usable geometry are ignored silently.
  const consumedFocusNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusedOverlayItem || consumedFocusNonce.current === focusedOverlayItem.nonce) return;
    const target = overlayItems.find((item) => item.id === focusedOverlayItem.itemId);
    if (!target) return;
    consumedFocusNonce.current = focusedOverlayItem.nonce;
    if (typeof target.pageNumber === "number" && target.pageNumber !== pageNumber) setPageNumber(target.pageNumber);
    setSelectedItemId(target.id);
    setActiveSourceTypes((current) => {
      if (current.has(target.sourceType)) return current;
      const next = new Set(current);
      next.add(target.sourceType);
      return next;
    });
  }, [focusedOverlayItem, overlayItems, pageNumber]);

  // One compact secondary detail per row, always drawn from a field already
  // present on that item's own evidence -- never a new interpretation. A detail
  // that only repeats the row's own title is skipped rather than shown as a
  // redundant source-text line.
  // Letters/digits only, with any parenthetical dropped -- shared by the row
  // title/secondary-line cleanup and the detail view, so "is this candidate
  // just restating the title" is judged the same way in both places.
  const coreText = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const titleCoreOf = (title: string) => coreText(String(title || "").replace(/\([^)]*\)/g, ""));
  const addsNothingToTitle = (title: string, text: unknown) => {
    const value = coreText(text);
    const titleCore = titleCoreOf(title);
    return !value || (Boolean(titleCore) && titleCore.includes(value));
  };

  // One known, purely mechanical bookkeeping suffix this app's own grounding
  // step appends to a persisted label ("(2 source text mentions; Unspecified)"
  // -- see app/domain/drawing-visual-evidence.mjs). Stripped for DISPLAY only;
  // item.label/evidence.rawLabel themselves are never changed or re-persisted.
  const BOOKKEEPING_SUFFIX = /\s*\(\s*\d+\s+(?:source\s+)?text\s+mentions;\s*[^)]*\)\s*$/i;

  // A readable finding name. Prefers the item's own clean interpreted value
  // when one exists for the shape that carries the bookkeeping suffix above
  // (cableSpecs' real spec is already stored separately, in evidence.
  // normalizedValue -- reusing it is exact, not a guess); otherwise strips
  // the known suffix pattern as a safety net. Meaningful qualifiers baked
  // into the label itself (a circuit's role/spare-status, an equipment's
  // explicit location) are untouched -- only the one recognized bookkeeping
  // pattern is ever removed.
  const readableTitle = (item: EvidenceRecord): string => {
    const ev = (item.evidence || {}) as EvidenceRecord;
    const label = String(item.label || "").trim();
    if (item.semanticType === "cableSpecs" && typeof ev.normalizedValue === "string" && ev.normalizedValue.trim()) {
      return ev.normalizedValue.trim();
    }
    return label.replace(BOOKKEEPING_SUFFIX, "").trim() || label;
  };

  const secondaryDetailFor = (item: EvidenceRecord) => {
    const ev = (item.evidence || {}) as EvidenceRecord;
    const title = readableTitle(item);
    // Only genuine quotes/qualifiers -- never an extraction-method name or a
    // bare "basis" tag, and never the "Interpreted as ..." phrasing (when a
    // normalized value is worth showing at all, it is shown plain).
    const candidates: string[] = [];
    if (typeof ev.evidenceQuote === "string" && ev.evidenceQuote) candidates.push(`\u201C${ev.evidenceQuote}\u201D`);
    if (typeof ev.explicitLocation === "string" && ev.explicitLocation) candidates.push(`Location: ${ev.explicitLocation}`);
    if (Array.isArray(ev.sourceTextReferences) && ev.sourceTextReferences[0]?.text)
      candidates.push(`\u201C${ev.sourceTextReferences[0].text}\u201D`);
    if (typeof ev.normalizedValue === "string" && ev.normalizedValue) candidates.push(ev.normalizedValue);
    if (typeof ev.matchBasis === "string" && ev.matchBasis) candidates.push(ev.matchBasis);
    if (typeof ev.nearbyText === "string" && ev.nearbyText) candidates.push(`Nearby text: ${ev.nearbyText}`);
    if (typeof ev.textContent === "string" && ev.textContent) candidates.push(ev.textContent);
    if (typeof ev.rawText === "string" && ev.rawText) candidates.push(ev.rawText);
    if (typeof ev.reference === "string" && ev.reference) candidates.push(`Reference: ${ev.reference}`);
    for (const candidate of candidates) {
      if (!addsNothingToTitle(title, candidate.replace(/^[\u201C"]|[\u201D"]$/g, ""))) return candidate;
    }
    // Nothing on the record adds a useful, engineering-relevant second line --
    // the row shows only its title. No extraction-method name or basis tag is
    // manufactured to fill the space.
    return "";
  };

  const statusFor = (item: EvidenceRecord) => {
    const override = generalExtractionReviewOverrides?.[item.id];
    const stored = String((override ? override.reviewStatus : item.reviewStatus) ?? "Needs Review");
    const reviewedBy = (override ? override.reviewedBy : item.reviewedBy) ?? null;
    const reviewedAt = (override ? override.reviewedAt : item.reviewedAt) ?? null;
    const reviewReason = (override ? override.reviewReason : item.reviewReason) ?? null;
    const reviewerScope = `Recorded by ${reviewedBy}${reviewedAt ? ` on ${new Date(reviewedAt).toLocaleString()}` : ""}.`;
    // A record can carry reviewer metadata (a "correct"/"conflict" action, or
    // one reverted back to its default status by a governance test) while
    // its STORED status is still "Needs Review" or "Conflict" -- a real,
    // observed case (a governance-test Callout Reference on the FCC ROOM
    // DETAILS sheet: reviewedBy set, status reverted to "Needs Review"). The
    // badge must reflect that real, unresolved status honestly -- a green
    // "reviewed" tone is only used when the stored status itself is
    // something other than those two, never merely because reviewer
    // metadata exists.
    const stillUnresolved = stored === "Needs Review" || stored === "Conflict";
    if (reviewedBy && !stillUnresolved) {
      // A reviewer can set the stored status to something extraction itself
      // never established (item.governedStatus is the system's own computed
      // status, untouched by any review action) -- a real, observed case on
      // this exact project (a cable-spec finding recorded "Verified" by a
      // review action whose reason is literally "tests", while extraction's
      // own governedStatus for it remained "Needs Review"). Never hidden:
      // the recorded status is shown as-is (never overridden back), but the
      // scope text says plainly that a person set it, distinct from
      // extraction's own governedStatus, whenever the two differ.
      const governed = "governedStatus" in item ? String(item.governedStatus ?? "") : "";
      const divergesFromExtraction = Boolean(governed) && governed !== stored;
      return {
        stored,
        label: stored,
        tone: "reviewed",
        scope: divergesFromExtraction
          ? `${reviewerScope} Extraction itself established "${governed}" for this record -- this status was set by that review action, not by extraction.`
          : reviewerScope,
        reviewReason,
        engineerRecorded: true,
      };
    }
    const preset =
      AUTOMATIC_STATUS_PRESENTATION[stored] ||
      { label: stored, tone: stored === "Conflict" ? "conflict" : "pending", scope: "Status as stored on this record." };
    return {
      stored,
      ...preset,
      scope: reviewedBy ? `${reviewerScope} Status is still ${stored}.` : preset.scope,
      reviewReason,
      engineerRecorded: Boolean(reviewedBy),
    };
  };

  // "Do not invent review reasons." A record awaiting review says exactly that;
  // an absent reason says it is absent, and nothing is inferred from status.
  const reviewReasonText = (status: ReturnType<typeof statusFor>) => {
    if (status.reviewReason) return String(status.reviewReason);
    if (!status.engineerRecorded && status.stored === "Needs Review")
      return "Awaiting review. No review reason recorded.";
    return "Review reason not recorded.";
  };

  const statusChip = (item: EvidenceRecord) => {
    const status = statusFor(item);
    return (
      <span className={`dwx-status-chip dwx-status-${status.tone}`} title={status.scope}>
        {status.label}
      </span>
    );
  };

  // ---------------------------------------------------------------------
  // Candidate-comparison runs (moved to History & tools -> Symbol analysis
  // experiments). Every run, image, raw response, hash, invalidation warning
  // and decision is preserved exactly as saved.
  // ---------------------------------------------------------------------
  const validCandidateRuns = candidateComparisons.filter(
    (run) => run.status === "Completed" && !run.result?.historyWarning,
  );
  const latestValidCandidateRun = validCandidateRuns.length
    ? validCandidateRuns.reduce((latest, run) => ((run.created_at || "") > (latest.created_at || "") ? run : latest))
    : null;
  const historicalCandidateRuns = candidateComparisons.filter((run) => run.id !== latestValidCandidateRun?.id);
  const candidateRunModelLabel = (run: CandidateComparisonRun) => {
    try {
      return run.model_info ? JSON.parse(run.model_info)?.visionModel || null : null;
    } catch {
      return null;
    }
  };
  const candidateRunDateLabel = (run: CandidateComparisonRun) =>
    run.created_at ? new Date(run.created_at).toLocaleString() : "Date not recorded";


  const renderCandidateRun = (run: CandidateComparisonRun) => {
    const comparisons = run.result?.comparisons || [];
    return (
      <div key={run.id} className="dwx-run">
        <div className="dwx-run-meta">
          <span>{candidateRunDateLabel(run)}</span>
          <span>{candidateRunModelLabel(run) || "Model not recorded"}</span>
          <span>
            {comparisons.length} pair{comparisons.length === 1 ? "" : "s"}
          </span>
          <span>{run.status}</span>
          {run.input_manifest?.candidateDrawingNumber && (
            <span>Candidate {run.input_manifest.candidateDrawingNumber}</span>
          )}
          <a
            href={`/api/documents/${encodeURIComponent(documentId)}/drawing-extraction/runs/${encodeURIComponent(run.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            Saved inputs and raw responses
          </a>
        </div>
        {run.result?.historyWarning && (
          <p className="dwx-invalid" role="note">
            {run.result.evaluationValidity || "Invalid for evaluation"}: {run.result.historyWarning}
          </p>
        )}
        {run.status !== "Completed" && (
          <p className="dwx-invalid" role="note">
            This run did not complete (status {run.status}). Nothing from it is a result.
          </p>
        )}
        <p className="dwx-run-applicability">
          {run.result?.applicability || run.input_manifest?.applicability || "Applicability not recorded"}
          {run.result?.referenceStatus ? ` · Reference ${run.result.referenceStatus}` : ""}
          {run.result?.revisionCompatibility ? ` · Revision compatibility ${run.result.revisionCompatibility}` : ""}
          {run.input_manifest?.approvedForTakeoff === false ? " · Not approved for takeoff" : ""}
          {run.input_manifest?.approvedForPricing === false ? " · Not approved for pricing" : ""}
        </p>
        {comparisons.map((pair, index) => (
          <details key={pair.id} className="dwx-comparison">
            <summary>
              Pair {index + 1} of {comparisons.length}
              {pair.evaluationValidity ? ` · ${pair.evaluationValidity}` : ""}
            </summary>
            {pair.evaluationValidity && <p className="dwx-invalid">{pair.evaluationValidity}</p>}
            <div className="dwx-comparison-images">
              <ComparisonImage
                caption="This drawing"
                alt="Symbol crop from this drawing"
                src={`/api/documents/${encodeURIComponent(documentId)}/drawing-extraction/runs/${encodeURIComponent(run.id)}/images/${pair.wlcImageIndex}`}
                provenance={pair.wlcEvidence}
              />
              <ComparisonImage
                caption={`Candidate legend entry: ${pair.literalDescription}`}
                alt={`Candidate legend entry: ${pair.literalDescription}`}
                src={`/api/documents/${encodeURIComponent(documentId)}/drawing-extraction/runs/${encodeURIComponent(run.id)}/images/${pair.legendImageIndex}`}
                provenance={pair.legendEvidence}
              />
            </div>
            <p className="dwx-note">
              Full stored crops, shown at their own aspect ratio with independent zoom. No validated symbol bounds are
              recorded inside these crops, so no normalised symbol-only view is offered for this run.
            </p>
            <p className="dwx-note">{pair.applicability || run.result?.applicability || "Applicability not recorded"}</p>
            {pair.assistantVisualInspection ? (
              <div className="dwx-observation">
                <p>
                  <strong>Assistant visual inspection:</strong> {pair.assistantVisualInspection.outcome} — not an
                  engineer approval.
                </p>
                <p>{pair.assistantVisualInspection.matchBasis}</p>
                <p>{pair.assistantVisualInspection.ambiguity}</p>
              </div>
            ) : (
              <p className="dwx-observation">
                <strong>No match/no-match verdict has been recorded for this pair.</strong> The model&rsquo;s description
                is below in technical details; it is not a verdict.
              </p>
            )}
            <p className="dwx-decision">
              <strong>Engineer decision:</strong>{" "}
              {pair.reviewedBy
                ? `Reviewed by ${pair.reviewedBy}`
                : `${pair.reviewStatus || "Needs Review"} — no engineer decision recorded yet`}
            </p>
            <details className="dwx-technical">
              <summary>Technical details</summary>
              <p>
                <strong>Model&rsquo;s raw visual observations</strong> (finish reason:{" "}
                {pair.modelFinishReason || "not recorded"}). These are the model&rsquo;s own words describing what it
                saw; they are not a verified match and can misread shapes or letters.
              </p>
              <p>{pair.modelAssessment || "(empty response)"}</p>
              <dl className="dwx-kv">
                <div>
                  <dt>This drawing crop sha256</dt>
                  <dd>{pair.wlcEvidence?.sha256 || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Candidate crop sha256</dt>
                  <dd>{pair.legendEvidence?.sha256 || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>This drawing crop region</dt>
                  <dd>{pair.wlcEvidence?.boundingBox ? JSON.stringify(pair.wlcEvidence.boundingBox) : "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Candidate crop region</dt>
                  <dd>{pair.legendEvidence?.boundingBox ? JSON.stringify(pair.legendEvidence.boundingBox) : "Not recorded"}</dd>
                </div>
              </dl>
            </details>
          </details>
        ))}
      </div>
    );
  };

  if (!pages.length)
    return (
      <EmptyState
        title="No pages indexed yet"
        detail="Run Drawing Intake to index pages before this drawing can be reviewed."
      />
    );

  const historicalAiFindings = (aiVisualFindings || []).filter((row) => row.supersededAt);
  const historicalAiCount = historicalAiFindings.length;

  // The unresolved cross-sheet reference, stated ONCE at reference level with
  // the real requested drawing number from the reference record and the real
  // candidate drawing number recorded on the comparison runs.
  const referenceMismatches = (() => {
    const allReferences = pageItems.filter(
      (item) => item.sourceType === "CrossSheetRef" || item.sourceType === "AiCrossSheetRef",
    );
    // Resolution is only ever attempted by the deterministic (CrossSheetRef)
    // family -- an AI-sourced sibling (AiCrossSheetRef) structurally never
    // carries resolvedTargetDocumentId at all (see drawing-visual-
    // understanding-contract.mjs), so its mere presence must never keep a
    // reference number flagged as a decision once its deterministic record
    // is genuinely resolved. Group by normalized number first, then decide
    // per group using the deterministic record when one exists; fall back
    // to the AI-only signal only when no deterministic record covers it.
    const byKey = new Map<string, typeof allReferences>();
    for (const item of allReferences) {
      const requestedDrawingNumber =
        String((item.evidence as EvidenceRecord)?.referencedDrawingNumber || item.label || "").trim();
      const key = (requestedDrawingNumber || item.id).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const group = byKey.get(key) || [];
      group.push(item);
      byKey.set(key, group);
    }
    const references: typeof allReferences = [];
    for (const group of byKey.values()) {
      const deterministic = group.find((item) => item.sourceType === "CrossSheetRef");
      if (deterministic) {
        const isResolved = Boolean((deterministic.evidence as EvidenceRecord)?.resolvedTargetDocumentId);
        if (!isResolved) references.push(deterministic);
        continue;
      }
      // No deterministic record for this number at all -- the only evidence
      // is the AI-only proposal, which never resolves; keep today's behavior.
      const aiItem = group.find((item) => item.sourceType === "AiCrossSheetRef");
      if (aiItem) references.push(aiItem);
    }
    const candidateNumbers = [
      ...new Set(
        candidateComparisons
          .map((run) => run.input_manifest?.candidateDrawingNumber)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const comparisonCount = candidateComparisons.reduce(
      (total, run) => total + (run.result?.comparisons?.length || 0),
      0,
    );
    if (!references.length && !candidateNumbers.length) return [];
    if (!references.length)
      return candidateNumbers.map((candidateDrawingNumber) => ({
        id: `candidate:${candidateDrawingNumber}`,
        itemId: null,
        requestedDrawingNumber: null,
        candidateDrawingNumber,
        comparisonCount,
        runCount: candidateComparisons.length,
      }));
    // One entry per REFERENCED DRAWING NUMBER, not per record: the same
    // reference is commonly extracted twice (once deterministically, once by
    // the visual pass), and an engineer needs to resolve it once.
    const byNumber = new Map<string, { id: string; itemId: string | null; requestedDrawingNumber: string | null; candidateDrawingNumber: string | null; comparisonCount: number; runCount: number }>();
    for (const item of references) {
      const requestedDrawingNumber =
        String((item.evidence as EvidenceRecord)?.referencedDrawingNumber || item.label || "").trim() || null;
      const key = (requestedDrawingNumber || item.id).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (byNumber.has(key)) continue;
      byNumber.set(key, {
        id: `ref:${key}`,
        itemId: item.id,
        requestedDrawingNumber,
        candidateDrawingNumber: candidateNumbers[0] || null,
        comparisonCount,
        runCount: candidateComparisons.length,
      });
    }
    return [...byNumber.values()];
  })();

  const attention = buildDrawingAttention({
    items: pageItems,
    groupedFindings: understandingSummary.groupedFindings,
    referenceMismatches,
  });
  const externalDecisions = (externalAttention || []).filter((entry) => entry.kind === "decision");
  const externalMissing = (externalAttention || []).filter((entry) => entry.kind === "missing");
  const externalPending = (externalAttention || []).filter((entry) => entry.kind === "pending");
  // The tab badge counts only ACTIONABLE decisions -- never a combined total
  // across decisions/missing-information/pending-review, which used to read
  // as one undifferentiated severity number. Each section below keeps its
  // own real count in its own heading.
  const actionableDecisionCount = attention.decisions.length + externalDecisions.length;
  const missingCount = attention.missing.length + externalMissing.length;
  const pendingCount = (attention.pending.awaitingReview.length ? 1 : 0) + externalPending.length;
  const hasAnyAttention = actionableDecisionCount > 0 || missingCount > 0 || pendingCount > 0;

  const membersById: Record<string, EvidenceRecord[]> = Object.assign(
    {},
    ...understandingSummary.groupedFindings.map((group) => group.members || {}),
  );

  const selectedBoxEntry = selectedItem
    ? pageItemsWithBox.find((entry) => entry.item.id === selectedItem.id) || null
    : null;

  // A stored/governed boundingBox is not assumed correct merely because it
  // exists -- drawing_assets.bounding_box is computed from a raw PDF text
  // item's own width/height (see drawing-intake-engine.mjs), which for a
  // run drawn at a real angle within the page (independent of the page's
  // own declared rotation) does not describe a page-axis-aligned box. No
  // rotation/transform is persisted per asset, so this cannot be checked
  // from stored data alone -- it is instead verified live, on demand, only
  // for the currently selected item, against the SAME PDF.js document
  // already loaded for the on-screen canvas (page.getTextContent(), the
  // real transform matrix). A confirmed real case on this exact document:
  // the "NAC LOOP" Loop Candidate's stored box maps to blank page space.
  //
  // TextTag symbol occurrences are checked differently (Phase 8A-UX-R4): their
  // box is built from the tag's own text transform, so the question is purely
  // geometric -- does the stored box match that tag's glyph extent?
  // (verifyTextTagHighlight). Rotation alone never withholds them, and they
  // stay withheld until the check has actually passed (fail closed).
  const [unverifiedHighlight, setUnverifiedHighlight] = useState<{ itemId: string; reason: string } | null>(null);
  const [tagHighlightVerdict, setTagHighlightVerdict] = useState<{ itemId: string; valid: boolean } | null>(null);
  const pageRendered = Boolean(canvasSize);
  useEffect(() => {
    let cancelled = false;
    setUnverifiedHighlight(null);
    const box = selectedItem?.boundingBox;
    const mode = highlightVerificationMode(selectedItem);
    if (!selectedItem || !box || !currentPage || mode === "none") return;
    const label = String(selectedItem.label || "").trim();
    if (mode === "text-angle" && !label) return;
    const verify = async () => {
      try {
        const pdf = pdfDocumentRef.current;
        if (!pdf || loadedDocumentIdRef.current !== documentId) return;
        const page = await pdf.getPage(currentPage.page_number);
        const textContent = await page.getTextContent();
        if (mode === "tag-geometry") {
          const verdict = verifyTextTagHighlight(selectedItem, textContent.items, page.view);
          if (cancelled) return;
          setTagHighlightVerdict({ itemId: selectedItem.id, valid: verdict.valid });
          if (!verdict.valid)
            setUnverifiedHighlight({
              itemId: selectedItem.id,
              reason:
                "Checked against the real PDF: this record's stored box does not match the drawn extent of its tag text, so it does not describe a reliable page position.",
            });
          return;
        }
        const [originX, originY] = page.view as [number, number, number, number];
        const normalizedLabel = label.toUpperCase().replace(/[^A-Z0-9]/g, "");
        let bestMatch: { transform: number[] } | null = null;
        let bestDistance = Infinity;
        for (const raw of textContent.items as Array<{ str?: string; transform?: number[] }>) {
          const text = String(raw.str || "").trim();
          if (!text) continue;
          const normalizedText = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (!normalizedText || (!normalizedLabel.includes(normalizedText) && !normalizedText.includes(normalizedLabel))) continue;
          const x = Number(raw.transform?.[4] || 0) - originX;
          const y = Number(raw.transform?.[5] || 0) - originY;
          const distance = Math.hypot(x - box.x, y - box.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = { transform: raw.transform || [] };
          }
        }
        if (cancelled || !bestMatch || bestDistance > 30) return; // no confident match found -- stay silent, never guess
        const [a, b, c, d] = bestMatch.transform;
        const rotationMagnitude = Math.hypot(b || 0, c || 0);
        const scaleMagnitude = Math.hypot(a || 0, d || 0) || 1;
        if (rotationMagnitude > 0.2 * scaleMagnitude) {
          setUnverifiedHighlight({
            itemId: selectedItem.id,
            reason:
              "Checked against the real PDF: the matching text is drawn at an angle its stored box does not account for, so the stored width/height do not describe a reliable page position.",
          });
        }
      } catch {
        // Best-effort verification only -- a failure here never fabricates a
        // warning. A TextTag simply stays withheld (no passing verdict).
      }
    };
    void verify();
    return () => {
      cancelled = true;
    };
  }, [selectedItem, currentPage, documentId, pageRendered]);
  const highlightVerifiedInvalid = Boolean(
    selectedItem &&
      (unverifiedHighlight?.itemId === selectedItem.id ||
        (highlightVerificationMode(selectedItem) === "tag-geometry" &&
          (tagHighlightVerdict?.itemId !== selectedItem.id || !tagHighlightVerdict.valid))),
  );

  // Evidence on a sheet-size drawing is often only a few pixels wide at a
  // fit-page scale. This zooms the viewer so the selected item's real stored
  // geometry fills a usable part of the viewport -- it changes the zoom, never
  // the geometry, and is available only when a real, governed box exists AND
  // that box has not just been verified invalid above (the sourceTextReferences
  // fallback is excluded too; see the canvas overlay comment).
  const evidenceBoxes = selectedBoxEntry && !highlightVerifiedInvalid ? [selectedBoxEntry.box] : [];
  const hasUnpositionedSourceText = !selectedBoxEntry && selectedSourceTextBoxes.length > 0;
  const zoomToEvidence = () => {
    if (!evidenceBoxes.length || !viewerArea) return;
    const left = Math.min(...evidenceBoxes.map((box) => box.left));
    const top = Math.min(...evidenceBoxes.map((box) => box.top));
    const right = Math.max(...evidenceBoxes.map((box) => box.left + box.width));
    const bottom = Math.max(...evidenceBoxes.map((box) => box.top + box.height));
    const width = Math.max(right - left, 1);
    const height = Math.max(bottom - top, 1);
    // Half the viewer in the tighter dimension: close enough to read, with
    // enough of the surrounding drawing left for context.
    const factor = Math.min(((viewerArea.width - FIT_PADDING) * 0.5) / width, ((viewerArea.height - FIT_PADDING) * 0.5) / height);
    setZoomRequest({ mode: "manual", value: clampScale(renderedScale * factor) });
  };

  // Splits two drawing numbers on "-" and flags any segment one has that the
  // other's segment multiset does not contain (case-insensitive), so a
  // one-segment difference like a missing "DR" renders visibly distinct
  // without assuming which side is "correct" or attempting alignment beyond
  // a straightforward set comparison. Used only for DISPLAY -- never changes
  // which number is stored as requested/candidate, and never claims a match.
  const diffDrawingNumberSegments = (a: string, b: string) => {
    const split = (value: string) => value.split("-").map((part) => part.trim()).filter(Boolean);
    const segmentsA = split(a);
    const segmentsB = split(b);
    const flagAgainst = (source: string[], other: string[]) => {
      const remaining = new Map<string, number>();
      for (const part of other) {
        const key = part.toUpperCase();
        remaining.set(key, (remaining.get(key) || 0) + 1);
      }
      return source.map((part) => {
        const key = part.toUpperCase();
        const count = remaining.get(key) || 0;
        if (count > 0) remaining.set(key, count - 1);
        return { text: part, differs: count === 0 };
      });
    };
    return { requested: flagAgainst(segmentsA, segmentsB), candidate: flagAgainst(segmentsB, segmentsA) };
  };
  const drawingNumberSegments = (segments: Array<{ text: string; differs: boolean }>) =>
    segments.map((segment, index) => (
      <span key={index}>
        {index > 0 ? "-" : ""}
        <span className={segment.differs ? "dwx-refseg-diff" : undefined}>{segment.text}</span>
      </span>
    ));

  const renderItemDetails = (item: OverlayItem) => {
    const record = item as EvidenceRecord;
    const ev = (item.evidence || {}) as EvidenceRecord;
    const status = statusFor(record);
    const members = membersById[item.id] || [];
    const title = readableTitle(item);
    const sourceTexts: Array<{ text: string; pageNumber?: number }> = Array.isArray(ev.sourceTextReferences)
      ? ev.sourceTextReferences
      : [];
    // The deterministic Cross-Sheet Reference engine stores its real quoted
    // note under evidence.noteText (a field name the generic excerpt readers
    // above never checked) -- recognizing it here reuses genuinely linked
    // evidence that already existed, rather than leaving a record that DOES
    // have a source quote looking like it has none.
    const noteExcerpt = typeof ev.noteText === "string" ? ev.noteText.trim() : "";
    const reviewable = REVIEWABLE_SOURCE_TYPES.includes(item.sourceType) && Boolean(props.onGeneralExtractionAction);
    const symbolReviewable = item.sourceType === "Symbol" || item.sourceType === "UnknownSymbol";
    const isCrossSheetRef = item.sourceType === "CrossSheetRef" || item.sourceType === "AiCrossSheetRef";
    const requestedNumber = typeof ev.referencedDrawingNumber === "string" ? ev.referencedDrawingNumber : null;
    // "resolvedTargetDocumentId" is a real key only on the deterministic
    // family's evidence -- an AI-sourced reference never attempts
    // resolution at all, so its absence there is distinct from "attempted
    // and failed" and is worded accordingly below.
    const resolutionAttempted = "resolvedTargetDocumentId" in ev;
    const resolvedTarget = ev.resolvedTargetDocumentId ? String(ev.resolvedTargetDocumentId) : null;
    // The one candidate document this app currently has on record for any
    // unresolved reference, from the real saved comparison runs -- never
    // invented, and never treated as a confirmed match.
    const candidateNumber =
      candidateComparisons.map((run) => run.input_manifest?.candidateDrawingNumber).find(Boolean) || null;
    const numberDiff = requestedNumber && candidateNumber ? diffDrawingNumberSegments(requestedNumber, candidateNumber) : null;
    const isSelected = selectedItemId === item.id;
    const hasEvidence = Boolean(
      sourceTexts.length ||
        ev.textContent ||
        ev.rawText ||
        ev.rawContent ||
        ev.evidenceQuote ||
        noteExcerpt ||
        ev.explicitLocation ||
        ev.reference ||
        ev.nearbyText ||
        ev.matchBasis ||
        ev.alias ||
        ev.linkedScheduleItem ||
        (item.sourceType === "Callout" && ev.leaderGeometry) ||
        (isCrossSheetRef && requestedNumber) ||
        item.sourceType === "Structure",
    );
    const showWhatWasFound = Boolean(
      ev.applicableSystem || ev.applicabilityStatus || ("drawingType" in record && record.drawingType) ||
        (typeof ev.normalizedValue === "string" && ev.normalizedValue && !addsNothingToTitle(title, ev.normalizedValue)),
    );
    const showUncertainty = status.stored === "Needs Review" || status.stored === "Conflict" || Boolean(ev.ambiguityNote);

    return (
      <div className="dwx-detail">
        <div className="dwx-detail-head">
          <small>{SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType}</small>
          <h4>{title || "(no label)"}</h4>
          {statusChip(record)}
        </div>

        {showWhatWasFound && (
          <section className="dwx-detail-block">
            <h5>What was found</h5>
            <dl className="dwx-kv">
              {typeof ev.normalizedValue === "string" && ev.normalizedValue && !addsNothingToTitle(title, ev.normalizedValue) && (
                <div>
                  <dt>Interpreted value</dt>
                  <dd>{ev.normalizedValue}</dd>
                </div>
              )}
              {Boolean(ev.applicableSystem) && (
                <div>
                  <dt>Applicable system</dt>
                  <dd>{String(ev.applicableSystem)}</dd>
                </div>
              )}
              {Boolean(ev.applicabilityStatus) && (
                <div>
                  <dt>Applicability / scope</dt>
                  <dd>{String(ev.applicabilityStatus)}</dd>
                </div>
              )}
              {"drawingType" in record && Boolean(record.drawingType) && (
                <div>
                  <dt>Drawing type</dt>
                  <dd>{String(record.drawingType)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {hasEvidence && (
          <section className="dwx-detail-block">
            <h5>Supporting evidence</h5>
            {isCrossSheetRef && requestedNumber && (
              <div className="dwx-refcompare-block">
                <p>
                  <strong>Requested drawing number:</strong> {requestedNumber}
                </p>
                {resolvedTarget ? (
                  <>
                    <p>
                      <strong>Resolved to:</strong> {resolvedTarget}
                    </p>
                    <p className="dwx-note">
                      A resolved target means a document with a matching drawing number was identified — revision
                      compatibility ({ev.revisionCompatibility ? String(ev.revisionCompatibility) : "Unknown"}),
                      engineering approval, and use for pricing are separate questions this does not settle.
                    </p>
                  </>
                ) : candidateNumber && numberDiff ? (
                  <>
                    <dl className="dwx-refcompare">
                      <div>
                        <dt>Requested</dt>
                        <dd>{drawingNumberSegments(numberDiff.requested)}</dd>
                      </div>
                      <div>
                        <dt>Candidate document</dt>
                        <dd>{drawingNumberSegments(numberDiff.candidate)}</dd>
                      </div>
                    </dl>
                    <p className="dwx-note">
                      Applicability to this sheet is unconfirmed — the requested number does not exactly match this
                      candidate document.
                    </p>
                  </>
                ) : resolutionAttempted ? (
                  <p className="dwx-note">
                    No document with this number was found in the project. Applicability is unconfirmed.
                  </p>
                ) : (
                  <p className="dwx-note">Resolution against the project&rsquo;s documents has not been attempted for this record.</p>
                )}
              </div>
            )}
            {ev.evidenceQuote && (
              <p>
                <strong>Evidence quote:</strong> “{ev.evidenceQuote}”
              </p>
            )}
            {ev.explicitLocation && (
              <p>
                <strong>Explicit location:</strong> {ev.explicitLocation}
              </p>
            )}
            {sourceTexts.length > 0 && (
              <ul className="dwx-source-list">
                {sourceTexts.map((source, index) => (
                  <li key={index}>
                    “{source.text}”{source.pageNumber ? ` — page ${source.pageNumber}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {!sourceTexts.length && noteExcerpt && <p className="dwx-source-excerpt">“{noteExcerpt}”</p>}
            {!sourceTexts.length && !noteExcerpt && (ev.textContent || ev.rawText || ev.rawContent) && (
              <p className="dwx-source-excerpt">“{String(ev.textContent || ev.rawText || ev.rawContent)}”</p>
            )}
            {ev.reference && (
              <p>
                <strong>Reference:</strong> {String(ev.reference)}
              </p>
            )}
            {ev.nearbyText && (
              <p>
                <strong>Nearby text:</strong> {String(ev.nearbyText)}
              </p>
            )}
            {ev.matchBasis && (
              <p>
                <strong>Match basis:</strong> {String(ev.matchBasis)}
              </p>
            )}
            {ev.alias && (
              <p>
                <strong>Alias:</strong> {String(ev.alias)}
              </p>
            )}
            {ev.linkedScheduleItem && (
              <p>
                <strong>Linked schedule item:</strong> {`${ev.linkedScheduleItem.itemNumber}. ${ev.linkedScheduleItem.description}`}
              </p>
            )}
            {item.sourceType === "Callout" && (
              <p>
                <strong>Leader geometry:</strong> {ev.leaderGeometry ? "Available" : "Not available for this drawing"}
              </p>
            )}
            {isSelected && evidenceBoxes.length > 0 && (
              <div className="dwx-actions">
                <button type="button" onClick={zoomToEvidence}>
                  Zoom to evidence
                </button>
                <button type="button" onClick={() => setZoomRequest({ mode: "fit-page", value: 1 })}>
                  Fit page
                </button>
              </div>
            )}
            {isSelected && hasUnpositionedSourceText && (
              <p className="dwx-note">
                Precise position on the drawing is not available for this text (extraction does not record
                orientation for a rotated label) — the wording above is the real source excerpt.
              </p>
            )}
            {isSelected && highlightVerifiedInvalid && unverifiedHighlight && (
              <p className="dwx-note">
                Precise position on the drawing is unavailable for this record. {unverifiedHighlight.reason} The
                wording above is the real source excerpt.
              </p>
            )}
          </section>
        )}

        {showUncertainty && (
          <section className="dwx-detail-block">
            <h5>Requires decision</h5>
            <p>
              <strong>Status:</strong> {status.stored} — {status.scope}
            </p>
            {ev.ambiguityNote && (
              <p>
                <strong>Ambiguity:</strong> {String(ev.ambiguityNote)}
              </p>
            )}
          </section>
        )}

        {symbolReviewable && (
          <div className="dwx-actions">
            <button onClick={() => props.onSymbolAction("occurrences", (item.sourceEntity as OverlaySourceEntity).id, "approve")}>Approve</button>
            <button onClick={() => props.onSymbolAction("occurrences", (item.sourceEntity as OverlaySourceEntity).id, "reject")}>Reject</button>
            <button onClick={() => props.onSymbolAction("occurrences", (item.sourceEntity as OverlaySourceEntity).id, "reassign")}>Reassign</button>
            <button onClick={() => props.onSymbolAction("occurrences", (item.sourceEntity as OverlaySourceEntity).id, "restore")}>Restore</button>
          </div>
        )}
        {item.sourceType === "Structure" && (
          <div className="dwx-actions dwx-actions-note">
            <p>
              Structural regions are reviewed as part of a governed review case, not individually — open the existing
              Structure Review to act on this region.
            </p>
            <button onClick={props.onOpenStructureReview}>Open Structure Review</button>
          </div>
        )}
        {item.sourceType === "Text" && (
          <p className="dwx-note" role="note">
            Drawing Intake text assets are proposal-only in v0 — there is no individual review action for a single text
            item yet.
          </p>
        )}
        {item.sourceType === "CrossSheetRef" && (
          <p className="dwx-note" role="note">
            Cross-sheet references are evidence, not a proposal to approve or reject — review the proposals on the
            referenced sheet itself instead.
          </p>
        )}
        {reviewable && (
          <div className="dwx-actions">
            {item.semanticType !== "Panel Candidate" && item.semanticType !== "Equipment Candidate" ? (
              <button onClick={() => props.onGeneralExtractionAction?.(item.id, "approve")}>Approve</button>
            ) : (
              <p className="dwx-note" role="note">
                A Potential Alias cannot be approved as a confirmed equipment identity in v0 — there is no tag/location
                evidence to verify a merge against.
              </p>
            )}
            <button onClick={() => props.onGeneralExtractionAction?.(item.id, "reject")}>Reject</button>
            <button onClick={() => props.onGeneralExtractionAction?.(item.id, "correct")}>Correct</button>
            <button onClick={() => props.onGeneralExtractionAction?.(item.id, "conflict")}>Mark Conflict</button>
            <button onClick={() => props.onGeneralExtractionAction?.(item.id, "restore")}>Restore</button>
          </div>
        )}

        <details className="dwx-technical">
          <summary>Technical details</summary>
          <dl className="dwx-kv">
            <div>
              <dt>Category</dt>
              <dd>{item.semanticType || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Stored status</dt>
              <dd>{status.stored}</dd>
            </div>
            <div>
              <dt>What that status means here</dt>
              <dd>{status.scope}</dd>
            </div>
            <div>
              <dt>Review reason</dt>
              <dd>{reviewReasonText(status)}</dd>
            </div>
            {Array.isArray(record.hardReviewReasons) && record.hardReviewReasons.length > 0 && (
              <div>
                <dt>Review triggers recorded</dt>
                <dd>
                  <ul>
                    {record.hardReviewReasons.map((reason: string, index: number) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {generalExtractionReviewOverrides?.[item.id]?.correctedValue !== undefined && (
              <div>
                <dt>Correction value</dt>
                <dd>{String(generalExtractionReviewOverrides[item.id].correctedValue)}</dd>
              </div>
            )}
            <div>
              <dt>Confidence</dt>
              <dd>{item.confidence === null || item.confidence === undefined ? "Not scored" : `${item.confidence}%`}</dd>
            </div>
            <div>
              <dt>Extraction method</dt>
              <dd>{item.extractionMethod || "Not recorded"}</dd>
            </div>
            {"authorityRole" in record && (
              <div>
                <dt>Authority role</dt>
                <dd>{String(record.authorityRole)}</dd>
              </div>
            )}
            {"governedStatus" in record && (
              <div>
                <dt>Governed status</dt>
                <dd>{String(record.governedStatus)}</dd>
              </div>
            )}
            <div>
              <dt>Bounding box</dt>
              <dd>
                {item.boundingBox
                  ? `x ${item.boundingBox.x?.toFixed?.(1)} · y ${item.boundingBox.y?.toFixed?.(1)} · w ${item.boundingBox.width?.toFixed?.(1)} · h ${item.boundingBox.height?.toFixed?.(1)}`
                  : "Not positioned on this page"}
              </dd>
            </div>
            {"sourceDrawingNumber" in record && Boolean(record.sourceDrawingNumber) && (
              <div>
                <dt>Drawing number</dt>
                <dd>{String(record.sourceDrawingNumber)}</dd>
              </div>
            )}
            {"sourceSheet" in record && Boolean(record.sourceSheet) && (
              <div>
                <dt>Sheet</dt>
                <dd>{String(record.sourceSheet)}</dd>
              </div>
            )}
            {"sourceRevision" in record && (
              <div>
                <dt>Revision</dt>
                <dd>{record.sourceRevision || "Not Found"}</dd>
              </div>
            )}
            <div>
              <dt>Source document</dt>
              <dd>{(item.sourceEntity as OverlaySourceEntity)?.documentId || documentId}</dd>
            </div>
            <div>
              <dt>Record id</dt>
              <dd>{item.id}</dd>
            </div>
          </dl>
          {members.length > 0 && (
            <div className="dwx-detail-block">
              <h5>Also grouped here ({members.length})</h5>
              <p className="dwx-note">
                These are separate records that describe the same thing. Each keeps its own evidence and its own status —
                reviewing this one does not review them.
              </p>
              <ul className="dwx-member-list">
                {members.map((member) => (
                  <li key={member.id}>
                    <button type="button" onClick={() => openFinding(member.id)}>
                      <span>{readableTitle(member)}</span>
                      <small>{SOURCE_TYPE_LABELS[member.sourceType] || member.sourceType}</small>
                    </button>
                    {statusChip(member)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      </div>
    );
  };

  // A referenced record counts as having real evidence only when it carries
  // an actual excerpt/quote or a real page position -- never assumed from
  // its existence alone. Drives the "View details" vs "View evidence" choice
  // below: "View evidence" is only ever offered when it will show something.
  const itemHasEvidence = (itemId: string | null | undefined) => {
    if (!itemId) return false;
    const target = pageItems.find((candidate) => candidate.id === itemId);
    if (!target) return false;
    const tev = (target.evidence || {}) as EvidenceRecord;
    return Boolean(
      (Array.isArray(tev.sourceTextReferences) && tev.sourceTextReferences.length) ||
        tev.evidenceQuote ||
        tev.textContent ||
        tev.rawText ||
        tev.rawContent ||
        tev.noteText ||
        tev.explicitLocation ||
        target.boundingBox,
    );
  };

  const renderAttentionEntry = (entry: {
    id: string;
    title: string;
    why: string;
    itemId?: string | null;
    actionLabel?: string;
    onAction?: () => void;
    historyNote?: string | null;
  }) => (
    <li key={entry.id} className="dwx-attention-item">
      <strong>{entry.title}</strong>
      <p>{entry.why}</p>
      {entry.historyNote && <p className="dwx-note dwx-attention-history">{entry.historyNote}</p>}
      {entry.onAction ? (
        <button type="button" onClick={entry.onAction}>
          {entry.actionLabel || "Open"}
        </button>
      ) : entry.itemId ? (
        <button type="button" onClick={() => openFinding(entry.itemId as string)}>
          {itemHasEvidence(entry.itemId) ? "View evidence" : "View details"}
        </button>
      ) : null}
    </li>
  );

  // Compact row for "Information not established by the current analysis":
  // no bordered card, and the shared boilerplate sentence every plain
  // missingOrAmbiguous entry carries (already stated once at section level)
  // is not repeated per row -- only a genuinely distinct reason (a specific
  // circuit's unresolved status, a grounding warning, the not-to-scale note)
  // is shown inline.
  const renderMissingEntry = (entry: {
    id: string;
    title: string;
    why: string;
    itemId?: string | null;
    actionLabel?: string;
    onAction?: () => void;
  }) => {
    const isGenericGap = entry.id.startsWith("missing:");
    return (
      <li key={entry.id} className="dwx-compact-row">
        <span className="dwx-compact-row-title">{entry.title}</span>
        {!isGenericGap && <span className="dwx-compact-row-reason">{entry.why}</span>}
        {entry.onAction ? (
          <button type="button" onClick={entry.onAction}>
            {entry.actionLabel || "Open"}
          </button>
        ) : entry.itemId ? (
          <button type="button" onClick={() => openFinding(entry.itemId as string)}>
            {itemHasEvidence(entry.itemId) ? "View evidence" : "View details"}
          </button>
        ) : null}
      </li>
    );
  };

  const overlayActiveCount = activeSourceTypes.size;

  return (
    <div className="dwx">
      <header className="dwx-header">
        <div className="dwx-identity">
          <h2>{sheetName || "Untitled sheet"}</h2>
          <p>
            {drawingNumber || "Drawing number not recorded"} ·{" "}
            {revision ? `Rev ${revision}` : "Revision not recorded"}
          </p>
        </div>
        {overallStatusLabel && <span className="dwx-overall-status">{overallStatusLabel}</span>}
        <div className="dwx-header-actions">
          <button
            type="button"
            className={secondaryView === "information" ? "active" : ""}
            onClick={() => setSecondaryView((view) => (view === "information" ? null : "information"))}
          >
            Drawing information
          </button>
          <button
            type="button"
            className={secondaryView === "history" ? "active" : ""}
            onClick={() => setSecondaryView((view) => (view === "history" ? null : "history"))}
          >
            History &amp; tools
          </button>
          {onClose && (
            <button type="button" className="dwx-close" onClick={onClose} aria-label="Close drawing workspace">
              Close
            </button>
          )}
        </div>
      </header>

      {/* Commercial-use / drawing-status / trust-level detail lives in
          Drawing information now, not as a banner repeated on every open --
          no action in this main view depends on it. If a future action here
          ever performs a commercial/pricing step, surface its own specific
          restriction next to that action rather than reintroducing a
          standing banner. */}

      <div className="dwx-body">
        <section className="dwx-viewer" aria-label="Drawing">
          <div className="dwx-viewer-toolbar">
            {pages.length > 1 ? (
              <label>
                Page
                <select value={pageNumber} onChange={(event) => setPageNumber(Number(event.target.value))}>
                  {pages.map((page) => (
                    <option key={page.id} value={page.page_number}>
                      {page.page_number}
                    </option>
                  ))}
                </select>
                <span className="dwx-page-total">of {pages.length}</span>
              </label>
            ) : (
              <span className="dwx-page-total">Page {pageNumber} of {pages.length}</span>
            )}
            <div className="dwx-zoom">
              <button type="button" onClick={() => stepZoom(-1)} disabled={renderedScale <= MIN_SCALE} aria-label="Zoom out">
                −
              </button>
              <span>{Math.round(renderedScale * 100)}%</span>
              <button type="button" onClick={() => stepZoom(1)} disabled={renderedScale >= MAX_SCALE} aria-label="Zoom in">
                +
              </button>
            </div>
            <div className="dwx-fit">
              <button
                type="button"
                className={zoomRequest.mode === "fit-page" ? "active" : ""}
                onClick={() => setZoomRequest({ mode: "fit-page", value: 1 })}
              >
                Fit page
              </button>
              <button
                type="button"
                className={zoomRequest.mode === "fit-width" ? "active" : ""}
                onClick={() => setZoomRequest({ mode: "fit-width", value: 1 })}
              >
                Fit width
              </button>
            </div>
            <div className="dwx-overlay-control">
              <button
                type="button"
                className={overlayPanelOpen ? "active" : ""}
                aria-expanded={overlayPanelOpen}
                onClick={() => setOverlayPanelOpen((open) => !open)}
              >
                Overlays{overlayActiveCount ? ` (${overlayActiveCount})` : ""}
              </button>
              {overlayPanelOpen && (
                <div className="dwx-overlay-panel" role="group" aria-label="Overlay filters">
                  <div className="dwx-overlay-panel-head">
                    <span>Highlight evidence families on the drawing</span>
                    <div>
                      <button type="button" onClick={() => setActiveSourceTypes(new Set(ALL_OVERLAY_SOURCE_TYPES))}>
                        All
                      </button>
                      <button type="button" onClick={() => setActiveSourceTypes(new Set())}>
                        None
                      </button>
                    </div>
                  </div>
                  <div className="dwx-overlay-filters">
                    {ALL_OVERLAY_SOURCE_TYPES.map((sourceType) => {
                      const count = pageItems.filter((item) => item.sourceType === sourceType).length;
                      if (!count) return null;
                      return (
                        <label key={sourceType} className={activeSourceTypes.has(sourceType) ? "active" : ""}>
                          <input
                            type="checkbox"
                            checked={activeSourceTypes.has(sourceType)}
                            onChange={() => toggleSourceType(sourceType)}
                          />
                          {SOURCE_TYPE_LABELS[sourceType] || sourceType} ({count})
                        </label>
                      );
                    })}
                  </div>
                  {unplacedVisibleItems.length > 0 && (
                    <details className="dwx-unplaced">
                      <summary>
                        {unplacedVisibleItems.length} selected-family item
                        {unplacedVisibleItems.length === 1 ? "" : "s"} have no usable page position
                      </summary>
                      <p>
                        Their stored coordinates fall outside this sheet&rsquo;s extracted bounds, or the record has none
                        at all. They are inspectable, never given an invented location.
                      </p>
                      <ul>
                        {unplacedVisibleItems.map((item) => (
                          <li key={item.id}>
                            <button type="button" onClick={() => openFinding(item.id)}>
                              {readableTitle(item) || "(no label)"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="dwx-viewer-area" ref={viewerAreaRef}>
            <div
              className="dwx-canvas-wrap"
              ref={canvasWrapRef}
              style={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
            >
              <canvas ref={canvasRef} />
              {currentPage &&
                canvasSize &&
                visibleItemsWithBox
                  // The selected item's own box is withheld here once live
                  // verification (above) has actually confirmed it does not
                  // describe a reliable page position -- never removed for
                  // any other item on the page, which keeps today's accepted
                  // overlay behavior unchanged everywhere it was not
                  // specifically checked and found wrong.
                  .filter((entry) => !(highlightVerifiedInvalid && entry.item.id === selectedItemId))
                  .map(({ item, box }) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`drawing-overlay-item drawing-overlay-${item.sourceType}${
                        selectedItemId === item.id ? " selected" : ""
                      }`}
                      style={{ left: box.left, top: box.top, width: Math.max(box.width, 4), height: Math.max(box.height, 4) }}
                      title={`${item.semanticType}: ${item.label}`}
                      onClick={() => openFinding(item.id)}
                    />
                  ))}
              {/* selectedSourceTextBoxes is intentionally NOT drawn here. Its
                  geometry comes from a raw PDF text item's stored width/height,
                  which for a rotated/vertical run does not match the run's real
                  page-space extent (a confirmed extraction limitation -- no
                  rotation signal is persisted per text item to correct this
                  from, and guessing which runs are affected is not acceptable).
                  Drawing a box here would risk a highlight that visibly does
                  not match its own quoted text. The quote itself is still
                  shown in Supporting evidence; only the on-canvas box and the
                  auto-scroll/zoom-to-it behavior are withheld -- see the
                  "position not available" note in renderItemDetails. */}
            </div>
            {rendering && !renderError && (
              <div className="dwx-viewer-loading" role="status">
                Rendering page…
              </div>
            )}
            {/* Overlaid, not stacked above the canvas: a message that took up
                layout space would shrink this measured area, which re-runs the
                fit/render effect, which clears the message -- an observed
                flicker loop. Overlaying keeps the measured area constant. */}
            {renderError && (
              <div className="dwx-viewer-message">
                <ErrorState message={renderError} />
              </div>
            )}
          </div>
        </section>

        <aside className="dwx-sidebar" aria-label="Findings and attention">
          <div className="dwx-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "findings"}
              className={sidebarTab === "findings" ? "active" : ""}
              onClick={() => {
                setSidebarTab("findings");
                setSidebarMode("list");
              }}
            >
              Findings ({understandingSummary.counts.currentEngineering})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "attention"}
              className={sidebarTab === "attention" ? "active" : ""}
              onClick={() => {
                setSidebarTab("attention");
                setSidebarMode("list");
              }}
            >
              Needs attention{actionableDecisionCount > 0 ? ` (${actionableDecisionCount})` : ""}
            </button>
          </div>
          <div className="dwx-sidebar-body">
            {sidebarMode === "detail" && selectedItem ? (
              <>
                <button type="button" className="dwx-back" onClick={() => setSidebarMode("list")}>
                  ← Back to {sidebarTab === "findings" ? "findings" : "needs attention"}
                </button>
                {renderItemDetails(selectedItem)}
              </>
            ) : sidebarTab === "findings" ? (
              understandingSummary.groupedFindings.length === 0 ? (
                <EmptyState
                  title="No current findings"
                  detail="Nothing has been extracted for this page yet. Analysis history and tools are under History & tools."
                />
              ) : (
                understandingSummary.groupedFindings.map(({ family, items }) => {
                  // A table/region summary (e.g. "Equipment Schedule List (14
                  // rows)" -- the general extraction engine's own fixed label
                  // template for any such container) restates rows already
                  // listed individually elsewhere in this same family; an
                  // unconfirmed alias-merge candidate (Panel/Equipment
                  // Candidate -- see the "cannot be approved... no tag/
                  // location evidence" note in the detail actions below) has
                  // no confirmed identity yet. Neither is itself a distinct
                  // engineering identification, so neither inflates the
                  // section's headline count -- both are still fully
                  // reachable, in their own collapsed "Supporting records".
                  const isSupportingRecord = (item: EvidenceRecord) =>
                    /\(\d+\s+rows?\)\s*$/i.test(String(item.label || "")) ||
                    item.semanticType === "Panel Candidate" ||
                    item.semanticType === "Equipment Candidate";
                  const primaryItems = items.filter((item) => !isSupportingRecord(item));
                  const supportingItems = items.filter(isSupportingRecord);
                  // When every PRIMARY item in a category shares the same
                  // status, that is stated once for the whole section instead
                  // of repeating an identical badge on every row. A category
                  // with mixed statuses keeps its per-row badges -- the
                  // exception stays visible.
                  const statusLabels = new Set(primaryItems.map((item) => statusFor(item).label));
                  const uniformStatus = primaryItems.length && statusLabels.size === 1 ? [...statusLabels][0] : null;
                  const renderRow = (item: EvidenceRecord, showBadge: boolean) => {
                    const title = readableTitle(item);
                    const secondary = secondaryDetailFor(item);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={selectedItemId === item.id ? "dwx-row selected" : "dwx-row"}
                          onClick={() => openFinding(item.id)}
                        >
                          <span className="dwx-row-title" title={title || undefined}>
                            {title || "(no label)"}
                          </span>
                          {secondary && <span className="dwx-row-detail">{secondary}</span>}
                          {showBadge && <span className="dwx-row-status">{statusChip(item)}</span>}
                        </button>
                      </li>
                    );
                  };
                  // Callouts are reference markers pointing at other content,
                  // not themselves primary engineering findings -- the whole
                  // family collapses by default, same as every other purely
                  // supporting list on this tab.
                  const collapseWholeFamily = family === "Callouts" && primaryItems.length > 0;
                  return (
                    <section key={family} className="dwx-group">
                      <h3>
                        {family} <span>{primaryItems.length}</span>
                      </h3>
                      {uniformStatus && (
                        <p className="dwx-group-status">
                          All {primaryItems.length} {primaryItems.length === 1 ? "is" : "are"} {uniformStatus.toLowerCase()}.
                        </p>
                      )}
                      {collapseWholeFamily ? (
                        <details className="dwx-group-collapsible">
                          <summary>
                            Show {primaryItems.length} callout{primaryItems.length === 1 ? "" : "s"}
                          </summary>
                          <ul className="dwx-rows">{primaryItems.map((item) => renderRow(item, !uniformStatus))}</ul>
                        </details>
                      ) : (
                        <ul className="dwx-rows">{primaryItems.map((item) => renderRow(item, !uniformStatus))}</ul>
                      )}
                      {supportingItems.length > 0 && (
                        <details className="dwx-group-collapsible dwx-group-supporting">
                          <summary>
                            Supporting records <span>{supportingItems.length}</span>
                          </summary>
                          <p className="dwx-note">
                            Table/list summaries and unconfirmed identity candidates -- not counted as distinct findings
                            above, and still fully reachable here.
                          </p>
                          <ul className="dwx-rows">{supportingItems.map((item) => renderRow(item, true))}</ul>
                        </details>
                      )}
                    </section>
                  );
                })
              )
            ) : (
              <div className="dwx-attention">
                {!hasAnyAttention ? (
                  <EmptyState
                    title="Nothing recorded needs attention"
                    detail="No conflicts, unresolved references, recorded gaps or pending reviews are stored for this page."
                  />
                ) : (
                  <>
                    {/* Actual decisions/conflicts, shown first and never
                        folded into a combined count with the sections below. */}
                    <section className="dwx-group">
                      <h3>
                        Decisions and conflicts <span>{actionableDecisionCount}</span>
                      </h3>
                      {actionableDecisionCount === 0 ? (
                        <p className="dwx-note">No conflicts or unresolved references require a decision on this page.</p>
                      ) : (
                        <ul className="dwx-attention-list">
                          {attention.decisions.map(renderAttentionEntry)}
                          {externalDecisions.map(renderAttentionEntry)}
                        </ul>
                      )}
                    </section>

                    {/* Recorded gaps -- collapsed by default, compact rows, no
                        per-row repetition of the shared explanatory sentence.
                        Never phrased as "not on the drawing"; only as "not
                        established by what has been read so far". */}
                    {missingCount > 0 && (
                      <details className="dwx-group dwx-group-collapsible">
                        <summary>
                          Information not established by the current analysis <span>{missingCount}</span>
                        </summary>
                        <p className="dwx-note">
                          Limits of what the current analysis has determined so far -- not a claim that the drawing itself
                          lacks this information.
                        </p>
                        <ul className="dwx-compact-list">
                          {attention.missing.map(renderMissingEntry)}
                          {externalMissing.map(renderMissingEntry)}
                        </ul>
                      </details>
                    )}

                    {/* Pending reviews -- separate from decisions, compact. */}
                    {pendingCount > 0 && (
                      <section className="dwx-group">
                        <h3>
                          Pending approval <span>{pendingCount}</span>
                        </h3>
                        <ul className="dwx-attention-list">
                          {attention.pending.awaitingReview.length > 0 && (
                            <li className="dwx-attention-item">
                              <strong>
                                {attention.pending.awaitingReview.length} finding
                                {attention.pending.awaitingReview.length === 1 ? "" : "s"} awaiting review
                              </strong>
                              <p>
                                Extracted and stored, with no engineer decision recorded yet. Nothing downstream treats
                                these as approved.
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setSidebarTab("findings");
                                  setSidebarMode("list");
                                }}
                              >
                                Open findings
                              </button>
                            </li>
                          )}
                          {externalPending.map(renderAttentionEntry)}
                        </ul>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>

        {secondaryView && (
          <div className="dwx-secondary" role="region" aria-label={secondaryView === "information" ? "Drawing information" : "History and tools"}>
            <header>
              <h3>{secondaryView === "information" ? "Drawing information" : "History & tools"}</h3>
              <button type="button" onClick={() => setSecondaryView(null)}>
                Back to drawing
              </button>
            </header>
            <div className="dwx-secondary-body">
              {secondaryView === "information" ? (
                drawingInformationContent || <EmptyState title="No drawing information recorded" detail="Nothing has been indexed for this drawing yet." />
              ) : (
                <>
                  <details className="dwx-tool">
                    <summary>Extraction and processing summary</summary>
                    <dl className="dwx-kv">
                      <div>
                        <dt>Distinct current engineering candidates</dt>
                        <dd>{understandingSummary.counts.currentEngineering}</dd>
                      </div>
                      <div>
                        <dt>Overlapping source interpretations grouped</dt>
                        <dd>{understandingSummary.counts.overlappingSources}</dd>
                      </div>
                      <div>
                        <dt>Source fragments (raw text/structure records)</dt>
                        <dd>{understandingSummary.counts.sourceFragments}</dd>
                      </div>
                      <div>
                        <dt>Historical AI outputs</dt>
                        <dd>{understandingSummary.counts.historical}</dd>
                      </div>
                      <div>
                        <dt>Proposals needing source clarification</dt>
                        <dd>{understandingSummary.counts.needsSourceClarification}</dd>
                      </div>
                    </dl>
                    <p className="dwx-note">
                      Source fragments and historical outputs are not additional engineering findings; they are excluded
                      from the findings count.
                    </p>
                    {understandingSummary.mainFindings.length > 0 && (
                      <details>
                        <summary>Findings in full, as one line per category</summary>
                        <ul>
                          {understandingSummary.mainFindings.map((line, index) => (
                            <li key={index}>{line}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <details>
                      <summary>Clarification list exactly as recorded</summary>
                      <ul>
                        {understandingSummary.needsClarification.map((line, index) => (
                          <li key={index}>{line}</li>
                        ))}
                      </ul>
                    </details>
                  </details>

                  {historicalAiCount > 0 && (
                    <details className="dwx-tool">
                      <summary>Analysis history ({historicalAiCount} superseded outputs)</summary>
                      <p className="dwx-note">
                        Previous model outputs are retained for comparison. Omission in a later run does not mean an item
                        is absent from the drawing.
                      </p>
                      <ul>
                        {historicalAiFindings.map((row) => (
                          <li key={row.id}>
                            {row.rawLabel} — historical review status: {row.reviewStatus}.{" "}
                            {row.historyWarning || "Superseded analysis; not counted as a current finding."}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {candidateComparisons.length > 0 && (
                    <details className="dwx-tool">
                      <summary>Symbol analysis experiments ({candidateComparisons.length} runs)</summary>
                      <p className="dwx-note">
                        An evaluation, not a review queue. Each run compares symbols from this drawing against legend
                        entries on a candidate document whose drawing number does not match this sheet&rsquo;s reference,
                        and the pairs were chosen to include deliberately different ones as well as provisionally
                        matching ones. Applicability is unconfirmed, nothing here is approved for takeoff or pricing, and
                        none of it counts as a finding.
                      </p>
                      {latestValidCandidateRun ? (
                        <>
                          <h4>Latest valid completed run</h4>
                          {renderCandidateRun(latestValidCandidateRun)}
                        </>
                      ) : (
                        <EmptyState
                          title="No valid completed comparison run"
                          detail="Every saved run is either historical, invalid, or did not complete — see the history below."
                        />
                      )}
                      {historicalCandidateRuns.length > 0 && (
                        <details>
                          <summary>Other runs, including invalid and failed ({historicalCandidateRuns.length})</summary>
                          {historicalCandidateRuns.map(renderCandidateRun)}
                        </details>
                      )}
                    </details>
                  )}

                  <details className="dwx-tool">
                    <summary>Experimental analysis tools</summary>
                    <p className="dwx-note">
                      Every control here calls a model and writes a new analysis run. Nothing on this page runs one
                      automatically — each requires this explicit click.
                    </p>
                    <div className="dwx-tool-actions">
                      <button
                        type="button"
                        onClick={() => void analyzeVisually()}
                        disabled={visualAnalysisStatus === "Rendering" || visualAnalysisStatus === "Analyzing" || !currentPage}
                      >
                        {visualAnalysisStatus === "Rendering"
                          ? "Rendering page images…"
                          : visualAnalysisStatus === "Analyzing"
                            ? "Analyzing with AI…"
                            : "Analyze visually (AI)"}
                      </button>
                      {visualAnalysisStatus === "Error" && <span className="dwx-error">{visualAnalysisError}</span>}
                      {documentId === CANDIDATE_COMPARISON_PILOT_DOCUMENT_IDS.wlc && (
                        <>
                          <button
                            type="button"
                            onClick={() => void renderCandidateComparisonPilotCrops()}
                            disabled={pilotStatus === "Rendering" || pilotStatus === "Submitting"}
                          >
                            {pilotStatus === "Rendering"
                              ? "Rendering crops from PDFs…"
                              : "Render candidate-comparison pilot crops (no model call yet)"}
                          </button>
                          {pilotStatus === "ReadyForReview" && (
                            <button type="button" onClick={() => void submitCandidateComparisonPilot()}>
                              Submit rendered crops to the comparison model
                            </button>
                          )}
                          {pilotStatus === "Submitting" && <span>Submitting to candidate-comparison…</span>}
                          {pilotStatus === "Error" && <span className="dwx-error">{pilotError}</span>}
                        </>
                      )}
                    </div>
                    {pilotDiagnostics.length > 0 && (
                      <details>
                        <summary>Render diagnostics ({pilotDiagnostics.length})</summary>
                        <ul className="dwx-mono">
                          {pilotDiagnostics.map((line, index) => (
                            <li key={index}>{line}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {(pilotStatus === "ReadyForReview" || pilotStatus === "Done") && pilotPreview.length > 0 && (
                      <details>
                        <summary>Rendered composites awaiting visual verification ({pilotPreview.length})</summary>
                        <p className="dwx-note">
                          Not yet submitted to the model. Verify each composite first: correct occurrence on LEFT,
                          correct legend row on RIGHT, complete symbol and any external qualifiers, no clipping.
                        </p>
                        {pilotPreview.map((row) => (
                          <div key={row.caseId} className="dwx-pilot-row">
                            <strong>{row.caseId}</strong> · {row.category} · {row.note} · crop {row.wlcElapsedMs}ms ·
                            legend crop {row.legendElapsedMs}ms
                            <div>
                              <img alt={`${row.caseId} composite`} src={row.compositeDataUrl} />
                            </div>
                          </div>
                        ))}
                      </details>
                    )}
                    {pilotStatus === "Done" && pilotSummary.length > 0 && (
                      <details>
                        <summary>Last in-app pilot run ({pilotSummary.length} cases)</summary>
                        <p className="dwx-note">
                          Evaluation only. The cross-sheet reference remains unresolved, candidate applicability remains
                          unconfirmed, and nothing here is approved for takeoff or pricing.
                        </p>
                        {pilotSummary.map((row) => (
                          <div key={row.caseId} className="dwx-pilot-row">
                            <strong>{row.caseId}</strong> · {row.category} · {row.note}
                            <p>
                              <strong>Model output ({row.modelFinishReason || "unknown finish reason"}):</strong>{" "}
                              {row.modelAssessment || "(empty response)"}
                            </p>
                            <p>
                              <strong>Prior external-tooling reference observation:</strong> {row.priorExternalObservation}
                            </p>
                            <p className="dwx-mono">
                              sha256 — crop: {row.wlcImageSha256} · legend crop: {row.legendImageSha256} · composite:{" "}
                              {row.comparisonImageSha256}
                            </p>
                          </div>
                        ))}
                      </details>
                    )}
                  </details>

                  {legacyToolsContent}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
