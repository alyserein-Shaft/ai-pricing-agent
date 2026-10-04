import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

// Routing-safety audit (2026-08-31): every governed downstream extractor the
// classifier can route to (BOQ, Technical Specification, Project Context --
// Supplier Quotation has no classification-status gate at all, see its own
// note below) previously accepted `!manual_review_required` as an
// ALTERNATIVE to `classification_status === "Manually Confirmed"`.
// manual_review_required is the classifier's OWN confidence heuristic,
// computed with zero human involvement on every upload -- a real,
// well-structured BOQ CSV genuinely clears that bar (proven functionally in
// tests/classification-automatic-downstream-routing.test.mjs), and the
// proven Supplier Quotation/BOQ and Commercial Offer/Price List taxonomy
// overlap means a misclassified document could too. Only a real,
// authenticated confirm/override action sets classification_status to
// "Manually Confirmed" -- that is now the sole gate everywhere.

test("BOQ extraction eligibility requires a real human confirmation, not the classifier's own confidence", async () => {
  const source = await readFile(new URL("worker/boq-extraction-api.mjs", root), "utf8");
  const gate = source.match(/const extractionEligibility = \(document\) => [^\n]+/)?.[0] || "";
  assert.match(gate, /document\.classification_status === "Manually Confirmed"/);
  assert.doesNotMatch(gate, /!document\.manual_review_required/, "manual_review_required must no longer be an alternative path to eligibility");
});

test("Technical Specification extraction (both the API gate and the background job gate) requires a real human confirmation", async () => {
  const api = await readFile(new URL("worker/specification-extraction-api.mjs", root), "utf8");
  const apiGate = api.match(/const eligible = \(document\) => [^\n]+/)?.[0] || "";
  assert.match(apiGate, /document\.classification_status === "Manually Confirmed"/);
  assert.doesNotMatch(apiGate, /!document\.manual_review_required/);

  const background = await readFile(new URL("worker/specification-extraction-background.mjs", root), "utf8");
  // The gate was hardened to compare a normalized document type (case/spacing
  // insensitive), so the anchor matches the normalized call. The assertion below
  // still requires the full classification-confirmation condition.
  const backgroundGate = background.match(/if \(normalizeDocumentType\(document\.primary_type\)[^\n]+/)?.[0] || "";
  assert.match(backgroundGate, /document\.classification_status !== "Manually Confirmed"/);
  assert.doesNotMatch(backgroundGate, /manual_review_required/);
});

test("Project Context extraction requires a real human confirmation, not merely the absence of manual_review_required", async () => {
  const source = await readFile(new URL("worker/project-context-api.mjs", root), "utf8");
  const gateBlock = source.slice(source.indexOf("if (\n    !classification"), source.indexOf("if (\n    !classification") + 200);
  assert.match(gateBlock, /classification\.status !== "Manually Confirmed"/);
  assert.doesNotMatch(gateBlock, /manual_review_required/);
});

// Supplier Quotation's dedicated intake endpoint (worker/supplier-price-intake-api.mjs)
// has no classification_status gate at all -- it is a separate, explicitly
// human-driven intake workflow (a project-owning user must directly POST a
// specific documentId to it), not part of the classification auto-pipeline.
// After the scheduleAutomaticClassification fix, it is only reachable via
// that same explicit human action (confirm + startExtraction) or a direct,
// deliberate call to the intake endpoint itself -- flagged here as a known
// gap for a future, separate decision, not silently claimed fixed.
test("Supplier Quotation intake is documented as a known gap, not silently assumed safe", async () => {
  const source = await readFile(new URL("worker/supplier-price-intake-api.mjs", root), "utf8");
  assert.doesNotMatch(source, /classification_status\s*===\s*"Manually Confirmed"/, "documents current reality: no classification gate exists here yet");
});
