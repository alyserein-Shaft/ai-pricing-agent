// Source-Backed Drawing Understanding pilot -- AI visual analysis contract.
//
// This is the ONE schema the structured-output synthesis call is required
// to validate against (native Workers AI response_format: json_schema, the
// same mechanism BOQ Understanding already uses -- see
// worker/boq-understanding-provider.mjs). Every finding an AI call produces
// is mapped by buildAiVisualUnderstandingProposals() below into the SAME
// proposal shape the deterministic drawing-intelligence-view-model.mjs
// engines already produce, so it flows through the EXISTING
// drawing_extraction_proposals persistence/review/audit path -- there is no
// second, parallel review system for AI findings.
//
// Governance: an AI finding is NEVER auto-approved and confidence is NEVER
// the approval gate (same rule as every deterministic engine). Every AI
// proposal is created with authorityRole "Unsupported" and governedStatus
// "Needs Review" -- a hard, structural default, not something the model's
// own confidence score can override. This module is pure: no fetch, no DOM,
// no DB, no model call -- the model call itself lives in
// worker/drawing-visual-understanding-provider.mjs.

const trim = (value) => String(value ?? "").trim();

// "basis" forces the model to separate what it actually read/saw
// (Observed) from any inference it made (Interpreted, e.g. "this appears to
// be a spare loop because no device tags follow it") -- required per
// finding, not just once for the whole response, so a single response can
// legitimately mix both without either kind silently borrowing the other's
// certainty.
const BASIS_ENUM = ["Observed", "Interpreted"];

const evidenceQuoteProperty = { evidenceQuote: { type: "string", description: "The exact text or visual detail this finding is grounded in -- a literal quote from the provided extracted text or image description, never a paraphrase invented by the model." } };
const basisProperty = { basis: { type: "string", enum: BASIS_ENUM } };

export const VISUAL_UNDERSTANDING_RESPONSE_SCHEMA = {
  name: "drawing_visual_understanding",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "drawingIdentity",
      "equipment",
      "circuits",
      "cableSpecs",
      "interfaces",
      "notes",
      "crossSheetReferences",
      "quantities",
      "missingOrAmbiguous",
    ],
    properties: {
      drawingIdentity: {
        type: "object",
        additionalProperties: false,
        required: ["drawingType", "purpose", ...Object.keys(basisProperty), ...Object.keys(evidenceQuoteProperty)],
        properties: { drawingType: { type: "string" }, purpose: { type: "string" }, ...basisProperty, ...evidenceQuoteProperty },
      },
      equipment: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "explicitLocation", ...Object.keys(basisProperty), ...Object.keys(evidenceQuoteProperty)],
          properties: {
            name: { type: "string" },
            // Explicitly nullable: "no stated location" is a real, common
            // answer (most symbols on an N.T.S. schematic have none) and
            // must never be silently coerced into an empty string that
            // looks like "checked and found blank".
            explicitLocation: { type: ["string", "null"], description: "Only a location EXPLICITLY stated in text near this equipment; null if none is stated -- never inferred from drawing position." },
            ...basisProperty,
            ...evidenceQuoteProperty,
          },
        },
      },
      circuits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "role", "spareStatus", ...Object.keys(basisProperty), ...Object.keys(evidenceQuoteProperty)],
          properties: {
            label: { type: "string", description: "The circuit's own tag, e.g. LOOP-1, NAC LOOP -- preserved verbatim, never normalized into a generic 'Loop N'." },
            role: { type: "string", description: "What kind of circuit this is per its own label/context (e.g. detection loop, notification appliance circuit) -- never assume every circuit is the same type." },
            spareStatus: { type: "string", enum: ["Spare / Unpopulated", "In Use", "Unknown"], description: "'Spare / Unpopulated' only if the drawing explicitly says so (e.g. the word SPARE next to the tag); otherwise Unknown -- never assume populated or spare without a stated label." },
            ...basisProperty,
            ...evidenceQuoteProperty,
          },
        },
      },
      cableSpecs: {
        type: "array",
        description: "Grouped by UNIQUE specification -- repeated identical mentions are one entry with multiple occurrences, not one entry per mention.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["specification", "occurrenceCount", "circuitContext", ...Object.keys(basisProperty)],
          properties: {
            specification: { type: "string", description: "e.g. '2 X 1.5 sq.mm' -- the literal spec text, not a paraphrase." },
            occurrenceCount: { type: "integer", description: "How many DISTINCT places this exact specification is mentioned/shown, not a cable length or quantity -- never inferred from an N.T.S. schematic." },
            circuitContext: { type: "string", description: "Which circuit(s) this spec is associated with, per the text itself; 'Unspecified' if the drawing does not state one." },
            ...basisProperty,
          },
        },
      },
      interfaces: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", ...Object.keys(basisProperty), ...Object.keys(evidenceQuoteProperty)],
          properties: { name: { type: "string", description: "The named external system, e.g. 'INTERFACE TO IBMS SYSTEM' -- verbatim." }, ...basisProperty, ...evidenceQuoteProperty },
        },
      },
      notes: {
        type: "array",
        items: { type: "string" },
        description: "General/explanatory notes stated on the sheet, verbatim or lightly trimmed -- never summarized into something the sheet does not literally say.",
      },
      crossSheetReferences: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["referencedDrawingNumber", ...Object.keys(evidenceQuoteProperty)],
          properties: { referencedDrawingNumber: { type: "string", description: "The literal drawing number referenced, preserved exactly even if it cannot be matched to a known document." }, ...evidenceQuoteProperty },
        },
      },
      quantities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["quantity", "sourceSymbolOrText", ...Object.keys(evidenceQuoteProperty)],
          properties: {
            quantity: { type: "integer", description: "An explicit count stated in text or a schedule (e.g. a numbered list of device tags) -- one symbol occurrence counts as one device; never a length or a guess." },
            sourceSymbolOrText: { type: "string", description: "The exact symbol/tag or text this quantity is attached to." },
            ...evidenceQuoteProperty,
          },
        },
      },
      missingOrAmbiguous: {
        type: "array",
        items: { type: "string" },
        description: "Real gaps, ambiguities, or apparent contradictions in the evidence provided -- e.g. a referenced drawing that could not be resolved, a circuit tag with no stated role, conflicting text. Never a restatement of a finding already reported above.",
      },
    },
  },
};

const SOURCE_TYPE_BY_CATEGORY = {
  equipment: "AiEquipment",
  circuits: "AiCircuit",
  cableSpecs: "AiCableSpec",
  interfaces: "AiInterface",
  crossSheetReferences: "AiCrossSheetRef",
  quantities: "AiQuantity",
};

const stableId = (documentId, revision, category, index) => `ai:${category}:${documentId}:${revision ?? "norev"}:${index}`;

// modelInfo: { provider, visionModel, synthesisModel } -- folded into every
// proposal's extractionMethod/evidence so a reviewer (or this pilot's own
// report) can see exactly which real model call produced a given finding,
// never a bare "AI" label with no traceable source.
export const buildAiVisualUnderstandingProposals = ({
  result,
  sourceDocument = {},
  revision = null,
  pageNumber = null,
  imageProvenance = [],
  modelInfo = {},
} = {}) => {
  if (!result || typeof result !== "object") return [];
  const proposals = [];
  const documentId = sourceDocument.id ?? null;
  const extractionMethod = `AI visual analysis (${modelInfo.visionModel || "vision model"} + ${modelInfo.synthesisModel || "synthesis model"})`;
  const baseEvidence = { drawingType: null, sourceDrawingNumber: sourceDocument.drawingNumber ?? null, sourceSheet: sourceDocument.sheetName ?? null, sourceRevision: revision ?? null, imageProvenance };

  const pushFinding = (category, index, label, evidence) => {
    proposals.push({
      id: stableId(documentId, revision, category, index),
      pageNumber,
      sourceType: SOURCE_TYPE_BY_CATEGORY[category] || "AiFinding",
      semanticType: category,
      proposalType: category,
      label: trim(label),
      confidence: null, // an AI finding's own self-reported certainty is deliberately not surfaced as a governance signal -- see module header.
      authorityRole: "Unsupported",
      governedStatus: "Needs Review",
      reviewStatus: "Needs Review",
      hardReviewReasons: ["AI_VISUAL_FINDING_REQUIRES_ENGINEER_CONFIRMATION"],
      boundingBox: null, // a language model's output is not a reliable pixel coordinate; never fabricate one.
      extractionMethod,
      drawingType: null,
      sourceDrawingNumber: sourceDocument.drawingNumber ?? null,
      sourceSheet: sourceDocument.sheetName ?? null,
      sourceRevision: revision ?? null,
      evidence: { ...baseEvidence, ...evidence, rawLabel: label, category },
      sourceEntity: { kind: "AiVisualFinding", id: stableId(documentId, revision, category, index), sourceReferences: [], documentId },
    });
  };

  if (result.drawingIdentity)
    pushFinding("drawingIdentity", 0, `${result.drawingIdentity.drawingType || "Unknown type"} — ${result.drawingIdentity.purpose || ""}`.trim(), {
      basis: result.drawingIdentity.basis,
      evidenceQuote: result.drawingIdentity.evidenceQuote,
    });
  (result.equipment || []).forEach((item, index) =>
    pushFinding("equipment", index, item.explicitLocation ? `${item.name} — ${item.explicitLocation}` : item.name, {
      basis: item.basis,
      evidenceQuote: item.evidenceQuote,
      explicitLocation: item.explicitLocation ?? null,
    }),
  );
  (result.circuits || []).forEach((item, index) =>
    pushFinding("circuits", index, `${item.label} (${item.role}) — ${item.spareStatus}`, {
      basis: item.basis,
      evidenceQuote: item.evidenceQuote,
      role: item.role,
      spareStatus: item.spareStatus,
    }),
  );
  (result.cableSpecs || []).forEach((item, index) =>
    pushFinding("cableSpecs", index, `${item.specification} (${item.occurrenceCount} text mentions; ${item.circuitContext})`, {
      basis: item.basis,
      normalizedValue: item.specification,
      occurrenceCount: item.occurrenceCount,
      circuitContext: item.circuitContext,
    }),
  );
  (result.interfaces || []).forEach((item, index) => pushFinding("interfaces", index, item.name, { basis: item.basis, evidenceQuote: item.evidenceQuote }));
  (result.crossSheetReferences || []).forEach((item, index) =>
    pushFinding("crossSheetReferences", index, `→ ${item.referencedDrawingNumber}`, { evidenceQuote: item.evidenceQuote, referencedDrawingNumber: item.referencedDrawingNumber }),
  );
  (result.quantities || []).forEach((item, index) =>
    pushFinding("quantities", index, `${item.sourceSymbolOrText} — stated count ${item.quantity}`, { evidenceQuote: item.evidenceQuote, quantity: item.quantity, sourceSymbolOrText: item.sourceSymbolOrText }),
  );
  // notes and missingOrAmbiguous are plain-string arrays in the schema (no
  // per-item basis/evidenceQuote to structure) -- still turned into real,
  // reviewable proposals so nothing the model actually validated is
  // silently dropped before persistence. missingOrAmbiguous specifically is
  // what the "what needs clarification" summary (Part 3) reads from.
  (result.notes || []).forEach((note, index) => pushFinding("notes", index, note, { evidenceQuote: note }));
  (result.missingOrAmbiguous || []).forEach((gap, index) => pushFinding("missingOrAmbiguous", index, gap, { evidenceQuote: gap }));

  return proposals;
};

// The narrative "what this drawing explains" summary (Part 3) is built ONLY
// from already-validated findings and their CURRENT review state -- never
// from raw model output directly -- so nothing unsupported by a real,
// governed proposal can reach the summary text. See
// buildDrawingUnderstandingSummary in drawing-understanding-summary.mjs.
export const VISUAL_UNDERSTANDING_CATEGORIES = Object.keys(SOURCE_TYPE_BY_CATEGORY);

// Native structured output is still untrusted. Validate the complete existing
// contract before a run can supersede any saved findings.
export function validateVisualUnderstanding(value) {
  const check=(v,schema)=>{
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    const kind=v===null?'null':Array.isArray(v)?'array':typeof v;
    if(!types.some(t=>t===kind || (t==='integer' && Number.isInteger(v))))return false;
    if(schema.enum && !schema.enum.includes(v))return false;
    if(kind==='array')return v.every(item=>check(item,schema.items));
    if(kind==='object')return (schema.required || []).every(k=>Object.hasOwn(v,k)) && Object.entries(v).every(([k,item])=>schema.properties?.[k]?check(item,schema.properties[k]):schema.additionalProperties!==false);
    return true;
  };
  return check(value,VISUAL_UNDERSTANDING_RESPONSE_SCHEMA.schema);
}
