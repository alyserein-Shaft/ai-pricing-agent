// Stage 9 (2026-09-01): DRAWING -> REQUIREMENT -> KNOWLEDGE HANDOFF.
//
// This module is the ONLY place drawing-derived evidence turns into an entry
// in the SAME canonical requirement model already used by BOQ/specification/
// product matching (app/domain/technical-requirement-engine.mjs). It creates
// no separate drawing-only product-selection path: every function here
// returns a requirement-shaped object with sourceType:"Drawing" that flows
// through the EXACT SAME consolidateRequirements / detectRequirementConflicts
// / detectAttributeValueConflicts / resolveApplicability machinery as every
// other source. Drawing evidence remains evidence -- it never sets a part
// number, manufacturer, or product identity.
//
// Governed, not inferred: a drawing occurrence only ever reaches this module
// once it is (a) review_status==="Approved" on a CURRENT (non-superseded)
// symbol recognition version, AND (b) its resolved System Knowledge Registry
// family matches (or is a governed synonym of) the SAME BOQ item's own
// APPROVED estimator understanding review family -- the exact governed-link
// contract Stage 6A already built and tested in
// app/domain/drawing-quantity-evidence-engine.mjs's resolveGovernedLink,
// reused here unmodified rather than re-implemented.
import { resolveGovernedLink } from "./drawing-quantity-evidence-engine.mjs";

export const DRAWING_REQUIREMENT_EVIDENCE_ENGINE_VERSION = "drawing-requirement-evidence-1.1.0";

// Section 2: not every drawing fact is the same kind of evidence. This is the
// governed taxonomy -- "wired" means a real producer in this codebase turns
// that evidence type into a canonical requirement entry today; a type that
// is not yet wired is honestly reported as such rather than silently
// fabricated. Extending "wired" to a new type requires a new, real producer
// function in this file, never a relabeling of an existing one.
export const DRAWING_EVIDENCE_TYPES = Object.freeze([
  { type: "Device Identity / Family Evidence", wired: true, producer: "buildDrawingDeviceIdentityRequirement", basis: "Approved drawing_symbol_occurrences grouped by legend identity, resolved to System/Family via the System Knowledge Registry." },
  { type: "Quantity Evidence", wired: true, producer: "computeApprovedQuantityEvidence (Stage 6A) + a Quantity Source Decision (Stage 9)", basis: "Count of approved occurrences per legend identity; never overwrites BOQ quantity, only feeds an explicit engineer decision." },
  { type: "Title-block / Version Evidence", wired: true, producer: "drawing-structural-parser.mjs Sheet Identity (Stage 7/7.5)", basis: "Structural title-block reconstruction; drives document/version identity, not device requirements directly." },
  { type: "Drawing-level System Evidence", wired: false, producer: null, basis: "Sheet Identity's discipline field is extracted but not yet projected into a requirement-model system confirmation." },
  { type: "Location / Floor / Zone Evidence", wired: false, producer: null, basis: "No structural floor/zone extraction exists yet; an occurrence's page number is the only location evidence currently captured." },
  { type: "Mounting Evidence", wired: false, producer: null, basis: "Present only as free text inside a legend description (e.g. 'CEILING MOUNTED'), never as a separate structured attribute." },
  { type: "Compatibility Hints", wired: false, producer: null, basis: "No drawing-derived compatibility/interface evidence exists yet." },
  { type: "Notes / Explicit Technical Requirements", wired: false, producer: null, basis: "General-notes text extraction exists for title blocks only; no drawing note is parsed into a requirement statement yet." },
]);

const text = (value) => String(value ?? "").trim();

// The id namespace for DRAWING-sourced requirement entries. A Drawing entry is
// an observation read off approved drawing evidence; it is NOT a row in
// technical_requirements and must never be persisted as though it were one.
//
// This namespace is the single authority for that distinction, exported so the
// persistence layer classifies by THIS constant instead of re-typing the prefix
// string. It is embedded in the id itself
// (`drawing-requirement:{recognitionVersionId}:{definitionKey}:{boqItemId}`),
// which is what makes the reference currentness-aware: superseding a recognition
// version yields a different reference, so the profile fingerprint changes and the
// prior applicability is superseded rather than silently reused.
export const DRAWING_REQUIREMENT_ID_PREFIX = "drawing-requirement:";
export const BOQ_REQUIREMENT_ID_PREFIX = "boq-requirement:";

// True when a requirement id belongs to the Drawing-evidence namespace.
export const isDrawingRequirementId = (requirementId) =>
  typeof requirementId === "string" && requirementId.startsWith(DRAWING_REQUIREMENT_ID_PREFIX);

// True when a requirement id belongs to the BOQ device-identity namespace.
export const isBoqDeviceIdentityRequirementId = (requirementId) =>
  typeof requirementId === "string" && requirementId.startsWith(BOQ_REQUIREMENT_ID_PREFIX);

// The authority class of a requirement entry, decided by which id namespace it
// was minted in. "Specification" is the ONLY class whose ids are real
// technical_requirements rows, and therefore the only one that may be
// foreign-keyed to that table.
//
// BOTH device-identity namespaces are synthetic observations -- one read off
// approved Drawing evidence, one derived from the BOQ row itself -- and neither
// is a clause of the specification. They are kept as distinct classes rather
// than collapsed, because "where did this come from" is a governance question a
// reviewer asks directly, and because treating BOQ-derived evidence as if it
// were Drawing evidence (or vice versa) would misstate its provenance.
export const REQUIREMENT_SOURCE_SPECIFICATION = "Specification";
export const REQUIREMENT_SOURCE_DRAWING_DEVICE_IDENTITY = "DrawingDeviceIdentity";
export const REQUIREMENT_SOURCE_BOQ_DEVICE_IDENTITY = "BOQDeviceIdentity";

// Classify a requirement id into its authority class, or null when the id is not
// in a recognised synthetic namespace (i.e. it is expected to be a real
// technical_requirements id). Returning null rather than defaulting to
// "Specification" is deliberate: a caller must positively recognise the
// synthetic namespaces, so an unrecognised new namespace cannot silently be
// treated as specification-derived and hit the foreign key.
export const requirementAuthorityClass = (requirementId) => {
  if (isDrawingRequirementId(requirementId)) return REQUIREMENT_SOURCE_DRAWING_DEVICE_IDENTITY;
  if (isBoqDeviceIdentityRequirementId(requirementId)) return REQUIREMENT_SOURCE_BOQ_DEVICE_IDENTITY;
  return null;
};

// A requirement-shaped object identical in field shape to the ones
// worker/technical-requirement-api.mjs's loadInputs() already produces from
// technical_requirements rows, so buildTechnicalRequirementProfile needs no
// special-casing for a Drawing-sourced entry.
export const buildDrawingDeviceIdentityRequirement = ({ evidenceGroup, boqItem, documentId, documentName, recognitionVersionId, drawingStatus = "UNKNOWN" }) => {
  if (!evidenceGroup?.system || !evidenceGroup.description) return null;
  const matchedFamily = evidenceGroup.families?.[0]?.family || null;
  if (!matchedFamily) return null;
  const occurrenceConfidences = (evidenceGroup.approvedOccurrences || []).map((occurrence) => Number(occurrence.confidence || 0));
  const confidence = occurrenceConfidences.length ? Math.round(occurrenceConfidences.reduce((sum, value) => sum + value, 0) / occurrenceConfidences.length) : 60;
  const pages = evidenceGroup.pages || [];
  return {
    id: `${DRAWING_REQUIREMENT_ID_PREFIX}${recognitionVersionId}:${evidenceGroup.definitionKey}:${boqItem.id}`,
    originalText: `${text(evidenceGroup.abbreviation)} -- ${evidenceGroup.description}`.trim(),
    normalizedRequirement: evidenceGroup.description,
    requirementType: "Informational",
    requirementCategory: "Device Identity Evidence",
    // A fixed attributeName (never the raw legend description text, which
    // is mounting/wording-specific and would almost never textually match
    // the BOQ's own bare family name even when both genuinely name the same
    // family) is what lets consolidateRequirements' keyOf group this
    // Drawing entry together with the comparable BOQ entry below into ONE
    // governed requirement, regardless of whether the two sides' actual
    // family VALUES agree or conflict -- the agreement/conflict question is
    // then answered correctly, on real values, by detectRequirementConflicts
    // (existing, unmodified) rather than by comparing description prose.
    attributeName: "Device Identity",
    system: evidenceGroup.system,
    category: evidenceGroup.families?.[0]?.category || null,
    condition: null,
    confidence,
    sourceType: "Drawing",
    // .source.page is kept a scalar (matching the same {page,pageTo,clause,
    // section} shape every other requirement source in this codebase uses,
    // e.g. requirement-intelligence-engine.mjs's own add()) so nothing
    // downstream that expects a single page number ever receives an array.
    // pageNumbers below retains the FULL real page list for traceability
    // (Section 13) without narrowing the shared shape.
    // drawingStatus (OPERATIONAL POLICY FOUNDATION Stage 1) is the
    // normalized document_versions.drawing_status of the document this
    // evidence came from -- the caller (worker/technical-requirement-api.mjs)
    // resolves it from the real row; this module stays pure and only
    // carries it through. It is what lets resolveSourceAuthorityRank
    // (drawing-authority-policy.mjs) distinguish an Approved IFC drawing
    // from a Tender/Reference drawing when this entry later competes for
    // governing-source selection in consolidateRequirements.
    source: { documentId, documentName: documentName || null, recognitionVersionId, page: pages[0] ?? null, pageTo: pages.length > 1 ? pages[pages.length - 1] : null, pageNumbers: pages, definitionKey: evidenceGroup.definitionKey, occurrenceIds: (evidenceGroup.approvedOccurrences || []).map((occurrence) => occurrence.id), drawingStatus },
    attributes: [{ name: "Family", operator: "Equal", normalizedValue: matchedFamily, normalizedUnit: null, confidence, source: { sourceType: "Drawing", documentId, page: pages[0] ?? null, pageNumbers: pages } }],
    standards: [], manufacturers: [], compatibility: [], accessories: [],
  };
};

// Only ever synthesized alongside a real Drawing entry (never on its own --
// see loadDrawingRequirementEvidence in worker/technical-requirement-api.mjs)
// so an item with no drawing evidence at all gets zero new requirement
// entries and zero behavior change. Represents the SAME already-governed
// fact (the engineer's own APPROVED AI Understanding Review family) the
// requirement engine already trusts elsewhere in this codebase -- it does
// not invent a new authority, it only makes that existing fact comparable,
// by attribute name (see attributeName on the Drawing entry above), against
// the Drawing entry so a real disagreement (Section 7: BOQ says Dome Camera
// / Drawing says Bullet Camera) is caught by the existing, unmodified
// detectRequirementConflicts, on real attribute VALUES rather than on
// description prose that would rarely match even when both sides agree.
export const buildBoqDeviceIdentityRequirement = ({ boqItem }) => {
  if (!boqItem.system || !boqItem.productFamily) return null;
  return {
    id: `${BOQ_REQUIREMENT_ID_PREFIX}device-identity:${boqItem.id}`,
    originalText: `BOQ / AI Understanding Review: ${boqItem.productFamily}`,
    normalizedRequirement: boqItem.productFamily,
    requirementType: "Informational",
    requirementCategory: "Device Identity Evidence",
    attributeName: "Device Identity",
    system: boqItem.system,
    category: boqItem.category || null,
    condition: null,
    confidence: 90,
    sourceType: "BOQ",
    source: { boqItemId: boqItem.id },
    attributes: [{ name: "Family", operator: "Equal", normalizedValue: boqItem.productFamily, normalizedUnit: null, confidence: 90, source: { sourceType: "BOQ", boqItemId: boqItem.id } }],
    standards: [], manufacturers: [], compatibility: [], accessories: [],
  };
};

// A synthetic "Confirmed" link for a requirement built by this module --
// mirrors worker/technical-requirement-api.mjs's own links shape
// ({requirementId,status,confidence,linkMethod,evidence}) so
// resolveApplicability's existing link?.status==="Confirmed" early return
// applies unmodified. Both entries this module ever produces represent an
// already-governed fact (an approved drawing occurrence set matched against
// an approved understanding review, or the approved understanding review
// itself), so both are genuinely confirmed, not a naive-heuristic guess.
export const drawingRequirementLink = (requirement) => ({
  requirementId: requirement.id,
  status: "Confirmed",
  confidence: requirement.confidence,
  linkMethod: requirement.sourceType === "Drawing" ? "Drawing evidence governed link (Stage 9)" : "Approved AI Understanding Review (Stage 9 comparability link)",
  evidence: requirement.sourceType === "Drawing" ? [`${requirement.source.occurrenceIds.length} approved drawing occurrence(s) on page(s) ${requirement.source.pageNumbers.join(", ")}`] : ["Approved AI Understanding Review canonical interpretation"],
});

// Section 1's real, resolved gap: given a project's CURRENT (non-superseded)
// drawing symbol recognition versions and one BOQ item's own APPROVED
// canonical interpretation, return the 0-2 requirement entries (Drawing,
// and a comparable BOQ entry) this handoff contributes -- computed live,
// never cached, exactly like Stage 6A's quantity evidence. An item with no
// approved understanding review, or no governed drawing link at all, gets
// an empty array -- zero behavior change for every BOQ item this stage does
// not concern.
export const buildDrawingRequirementEntries = ({ evidenceGroups, boqItem, canonicalInterpretation, reviewStatus }) => {
  const drawingRequirements = [];
  for (const { evidenceGroup, documentId, documentName, recognitionVersionId, drawingStatus } of evidenceGroups) {
    if (!resolveGovernedLink({ evidenceGroup, canonicalInterpretation, reviewStatus })) continue;
    const requirement = buildDrawingDeviceIdentityRequirement({ evidenceGroup, boqItem, documentId, documentName, recognitionVersionId, drawingStatus });
    if (requirement) drawingRequirements.push(requirement);
  }
  if (!drawingRequirements.length) return { requirements: [], links: [] };
  const boqRequirement = buildBoqDeviceIdentityRequirement({ boqItem });
  const requirements = boqRequirement ? [...drawingRequirements, boqRequirement] : drawingRequirements;
  return { requirements, links: requirements.map((requirement) => drawingRequirementLink(requirement)) };
};
