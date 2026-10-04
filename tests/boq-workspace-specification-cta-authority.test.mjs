import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentDownstreamState } from "../app/domain/document-downstream-state.mjs";
import { documentClassificationPresentation } from "../app/lib/document-status-presentation.mjs";

// CTA Authority Fix, BOQ workspace (2026-09-08). Same-class defect as the
// one already fixed in the Documents workspace: the BOQ workspace's
// "Technical specification requirements" review launcher showed an
// executable Start/Re-run extraction button keyed only on
// document.specification_extraction_id presence, with no check that the
// CURRENT governed classification is a human-confirmed Technical
// Specification. worker/specification-extraction-background.mjs's
// createSpecificationJob rejects both "start" and "rerun" with
// SPECIFICATION_CLASSIFICATION_CONFIRMATION_REQUIRED unless
// primary_type === "Technical Specification" && classification_status ===
// "Manually Confirmed" -- verified this authority check is IDENTICAL for
// both operations (the `force` parameter rerun passes is accepted but never
// read anywhere in the function; it does not relax the gate).

test("B. backend authority rule: createSpecificationJob requires Manually Confirmed for BOTH start and rerun, with no relaxed rule for rerun", async () => {
  const source = await readFile(new URL("../worker/specification-extraction-background.mjs", import.meta.url), "utf8");
  const signatureEnd = source.indexOf("=> {", source.indexOf("export const createSpecificationJob")) + 4;
  const fn = source.slice(signatureEnd, source.indexOf("const active = await activeJob"));
  assert.match(fn, /normalizeDocumentType\(document\.primary_type\) !== "Technical Specification" \|\| document\.classification_status !== "Manually Confirmed"/);
  assert.match(fn, /SPECIFICATION_CLASSIFICATION_CONFIRMATION_REQUIRED/);
  // The check is the first real statement in the function body (only the
  // schema-migration and document-lookup lines precede it) and is not
  // wrapped in any `if (force ...)`/`if (!force ...)` branch -- proving
  // rerun (which passes force: true) gets no relaxed rule. `force` itself
  // is never referenced anywhere in the function body below the signature.
  assert.doesNotMatch(fn, /\bforce\b/, "force must not appear anywhere in the function body -- it does not gate or relax the confirmation check");
});

// ---------------------------------------------------------------------------
// 1 & 2: Start extraction visibility
// ---------------------------------------------------------------------------

test("1. unconfirmed Technical Specification: no Start extraction CTA (downstream_state never recommends it)", () => {
  const document = {
    predicted_type: "Technical Specification",
    document_type: "Technical Specification",
    classification_status: "Classified", // automatic, never human-confirmed
    classification_id: "c1",
    manual_review_required: 0,
  };
  const state = documentDownstreamState(document);
  assert.notEqual(state.recommendedAction, "Start specification extraction");
  assert.equal(state.recommendedAction, "Review type");
});

test("2. confirmed Technical Specification, no extraction yet: Start extraction is available", () => {
  const document = {
    predicted_type: "Technical Specification",
    document_type: "Technical Specification",
    classification_status: "Manually Confirmed",
  };
  const state = documentDownstreamState(document);
  assert.equal(state.recommendedAction, "Start specification extraction");
});

// ---------------------------------------------------------------------------
// 3: stale mirror disagreement
// ---------------------------------------------------------------------------

test("3. stale mirror says Technical Specification but governed type differs: no specification extraction CTA", () => {
  const document = {
    predicted_type: "Drawing",
    document_type: "Technical Specification", // stale mirror, must be ignored
    classification_status: "Manually Confirmed",
  };
  const state = documentDownstreamState(document);
  assert.notEqual(state.recommendedAction, "Start specification extraction");
  assert.equal(state.kind, "Drawing");
});

// ---------------------------------------------------------------------------
// 4: governed type correct but not confirmed
// ---------------------------------------------------------------------------

test("4. governed type Technical Specification but status is Classified: no extraction CTA", () => {
  const document = {
    predicted_type: "Technical Specification",
    document_type: "BOQ", // stale mirror pointing at a different, wrong type
    classification_status: "Classified",
    classification_id: "c1",
    manual_review_required: 0,
  };
  const state = documentDownstreamState(document);
  assert.notEqual(state.recommendedAction, "Start specification extraction");
  assert.notEqual(state.recommendedAction, "Start BOQ extraction");
  assert.equal(state.recommendedAction, "Review type");
});

// ---------------------------------------------------------------------------
// 5: Manually Confirmed + existing extraction -> re-run follows the real
// backend rule (documentClassificationPresentation.confirmed, the same
// helper the rest of the codebase already uses for this exact check)
// ---------------------------------------------------------------------------

test("5. Manually Confirmed + existing extraction: Re-run is available; not-confirmed + existing extraction: Re-run is not available", () => {
  const confirmedWithExtraction = {
    predicted_type: "Technical Specification",
    classification_status: "Manually Confirmed",
    specification_extraction_id: "sx1",
  };
  assert.equal(documentClassificationPresentation(confirmedWithExtraction).confirmed, true);

  const unconfirmedWithExtraction = {
    predicted_type: "Technical Specification",
    classification_status: "Classified",
    specification_extraction_id: "sx1",
  };
  assert.equal(documentClassificationPresentation(unconfirmedWithExtraction).confirmed, false);
});

// ---------------------------------------------------------------------------
// Unknown -> no CTA (covered by the Documents workspace suite's equivalent
// test too, re-verified here for the BOQ workspace's own derivation)
// ---------------------------------------------------------------------------

test("Unknown governed classification: no specification extraction CTA regardless of a stale Technical Specification mirror", () => {
  const document = {
    predicted_type: "Unknown",
    document_type: "Technical Specification",
    classification_status: "Needs Review",
  };
  const state = documentDownstreamState(document);
  assert.notEqual(state.recommendedAction, "Start specification extraction");
});

// ---------------------------------------------------------------------------
// 6: UI action cannot contradict the backend authority gate -- source proof
// that both the Start and Re-run conditions in the BOQ workspace launcher
// derive from the same shared, governed helpers the backend gate itself
// matches, not an independently invented condition.
// ---------------------------------------------------------------------------

test("6. the BOQ workspace launcher's Start/Re-run CTA cannot contradict backend authority -- both conditions derive from the shared governed helpers", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const launcherStart = page.indexOf('aria-label="Technical specification extraction review"');
  const launcherEnd = page.indexOf("</aside>", launcherStart);
  const launcher = page.slice(launcherStart, launcherEnd);

  assert.match(
    launcher,
    /const canStartSpecificationExtraction =\s*\n\s*document\.downstream_state\?\.recommendedAction ===\s*\n\s*"Start specification extraction";/,
    "Start must derive from document.downstream_state.recommendedAction",
  );
  assert.match(
    launcher,
    /const canRerunSpecificationExtraction =\s*\n\s*Boolean\(document\.specification_extraction_id\) &&\s*\n\s*documentClassificationPresentation\(document\)\.confirmed;/,
    "Re-run must derive from documentClassificationPresentation(document).confirmed, the same governed helper used elsewhere",
  );
  assert.match(
    launcher,
    /\{\(canStartSpecificationExtraction \|\|\s*\n\s*canRerunSpecificationExtraction\) && \(/,
    "the button itself must be gated on the two derived conditions, not a third independent check",
  );
});
